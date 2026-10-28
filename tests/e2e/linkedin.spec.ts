import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { ConnectionDraft, Lead } from '@shared/types/linkedin';
import { LinkedInStore } from '../../automation-server/src/adapters/linkedin/store';
import { createApp } from '../../automation-server/src/server/app';
import type { MockLinkedInOptions } from '../mock/mockLinkedIn';
import { addLeadTask, addLinkedInAccount, createEnv, logsOf, waitForRun, type TestEnv } from '../helpers/env';

/**
 * The production LinkedIn adapter, executor and API against the mock LinkedIn site (tests/mock).
 * Proves: leads are found and de-duplicated, drafts wait for review, and a request is only sent
 * through an explicit per-lead confirmation — verified by "Pending" on the profile.
 */
let env: TestEnv;
let server: http.Server;
let api: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  await env?.close();
});

async function setup(linkedin: MockLinkedInOptions = {}) {
  env = await createEnv({ mock: false, linkedin, settings: { verificationWaitSec: 30 } });
  const { app, token } = createApp(env.services);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // node:http, not fetch: fetch refuses some ports ("bad port") that the OS may pick for the test server.
  api = (method, path, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  const account = await addLinkedInAccount(env);
  return { account, store: new LinkedInStore(env.services.db.raw), mock: env.linkedin! };
}

const RECRUITERS = { keywords: 'Technical Recruiter', locations: ['India'], connectionDegree: '2nd', maxLeads: 20, maxCandidates: 10 };

async function runTask(taskId: string) {
  return waitForRun(env, env.services.executor.enqueue({ taskId, trigger: 'manual' }).id, 150_000);
}

test.describe('LinkedIn Lead Finder', () => {
  test('finds and filters leads, prepares drafts and waits for review — sends nothing', async () => {
    const { account, store, mock } = await setup();
    const task = addLeadTask(env, account.id, 'Find Technical Recruiters', {
      ...RECRUITERS,
      action: 'prepare_with_note',
      noteMode: 'personalized',
      note: 'Hi {firstName}, I would be glad to connect and learn about opportunities at {company}.',
    });
    const run = await runTask(task.id);
    expect(run.status, logsOf(env, run.id)).toBe('waiting_for_review');

    // Search used LinkedIn's own query params; only 2nd-degree results were requested.
    const url = mock.searchUrls[0]!;
    expect(url.searchParams.get('keywords')).toBe('Technical Recruiter');
    expect(url.searchParams.get('network')).toBe('["S"]');

    // Filters: 2nd degree, in India, has a profile link (the anonymous "LinkedIn Member" is ignored).
    const leads = store.listLeads({ accountId: account.id, limit: 50 }).leads;
    const names = leads.map((l) => l.name).sort();
    expect(names).toContain('Rahul Sharma');
    expect(names).not.toContain('John Smith'); // London
    expect(names).not.toContain('Amit Verma'); // 3rd degree
    expect(names).not.toContain('Sara Khan'); // 1st degree
    expect(names).not.toContain('LinkedIn Member');

    const drafts = store.listDrafts({ status: 'pending' });
    expect(drafts.length).toBe(leads.length);
    expect(run.reviewCount).toBe(drafts.length);
    const rahul = drafts.find((d) => d.lead.name === 'Rahul Sharma')!;
    expect(rahul.note).toBe('Hi Rahul, I would be glad to connect and learn about opportunities at ABC Technologies.');
    expect(rahul.lead.status).toBe('READY_FOR_CONNECTION');
    expect(mock.invitations).toEqual([]);

    expect(env.services.tasks.view(task.id)).toMatchObject({ state: 'WAITING_FOR_REVIEW', pendingReview: drafts.length });
    expect(env.services.db.notifications.list()[0]).toMatchObject({ type: 'ACTION_REQUIRED', link: '#/platforms/linkedin/drafts' });
    const log = logsOf(env, run.id);
    for (const line of ['Search criteria loaded', 'Search results reviewed', 'lead(s) identified', 'connection candidate(s) prepared', 'Task waiting for your review']) {
      expect(log).toContain(line);
    }
  });

  test('a second run does not duplicate leads or re-propose skipped ones', async () => {
    const { account, store } = await setup();
    const task = addLeadTask(env, account.id, 'Recruiters', { ...RECRUITERS, maxCandidates: 3 });
    await runTask(task.id);
    const first = store.listLeads({ accountId: account.id, limit: 50 });
    const skipped = store.listDrafts({ status: 'pending' })[0]!;
    expect((await api('POST', `/platforms/linkedin/leads/${skipped.leadId}/skip`)).body.status).toBe('SKIPPED');

    const second = await runTask(task.id);
    expect(second.result).toMatchObject({ newLeads: 0 });
    expect(store.listLeads({ accountId: account.id, limit: 50 }).total).toBe(first.total);
    const pending = store.listDrafts({ status: 'pending' });
    expect(pending.some((d) => d.leadId === skipped.leadId)).toBe(false);
    expect(store.lead(skipped.leadId)!.status).toBe('SKIPPED');
  });

  test('"Find leads only" stores leads without preparing any connection', async () => {
    const { account, store } = await setup();
    const task = addLeadTask(env, account.id, 'Just find', { ...RECRUITERS, action: 'find_only' });
    const run = await runTask(task.id);
    expect(run.status).toBe('success');
    expect(store.listDrafts({})).toHaveLength(0);
    expect(store.listLeads({ accountId: account.id }).leads.every((l) => l.status === 'NEW')).toBe(true);
  });

  test('signed out → a clear "sign in again" failure; security check → action required', async () => {
    let { account } = await setup({ requireLogin: true });
    let run = await runTask(addLeadTask(env, account.id, 'x', RECRUITERS).id);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'AUTH_REQUIRED' });
    expect(run.error).toMatch(/LinkedIn session is no longer available/);
    await env.close();

    ({ account } = await setup({ challenge: true }));
    run = await runTask(addLeadTask(env, account.id, 'x', RECRUITERS).id);
    expect(run).toMatchObject({ status: 'action_required', errorCode: 'CAPTCHA_REQUIRED' });
  });

  test('Connect lets you sign in yourself in a visible window (no password stored)', async () => {
    test.skip(!!process.env.CI, 'needs a desktop for a headed browser');
    const { account, mock } = await setup({ requireLogin: true, autoLoginAfterMs: 1500 });
    const run = await waitForRun(env, env.services.executor.enqueue({ accountId: account.id, systemTask: 'CONNECT', trigger: 'manual' }).id, 60_000);
    expect(run.status, logsOf(env, run.id)).toBe('success');
    expect(mock.sessions.size).toBe(1);
    const again = await runTask(addLeadTask(env, account.id, 'after sign-in', RECRUITERS).id);
    expect(again.status).toBe('waiting_for_review');
  });
});

test.describe('LinkedIn connection — user confirmation only', () => {
  async function prepared(opts: MockLinkedInOptions = {}) {
    const ctx = await setup(opts);
    const task = addLeadTask(env, ctx.account.id, 'Recruiters', RECRUITERS);
    await runTask(task.id);
    const byName = (name: string) => ctx.store.listLeads({ accountId: ctx.account.id, limit: 50 }).leads.find((l) => l.name === name)!;
    return { ...ctx, byName };
  }
  const confirm = async (lead: Lead, note: string | null) => {
    const res = await api('POST', `/platforms/linkedin/leads/${lead.id}/confirm-connection`, { confirm: true, note });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return waitForRun(env, res.body.id, 90_000);
  };

  test('refuses to send without the explicit confirmation flag', async () => {
    const { byName, mock } = await prepared();
    const res = await api('POST', `/platforms/linkedin/leads/${byName('Rahul Sharma').id}/confirm-connection`, { note: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/explicit confirmation/);
    expect(mock.invitations).toEqual([]);
  });

  test('sends exactly the one confirmed request, with the edited note, verified by "Pending"', async () => {
    const { byName, mock, store } = await prepared();
    const rahul = byName('Rahul Sharma');
    const run = await confirm(rahul, 'Hi Rahul, glad to connect!');
    expect(run.status, logsOf(env, run.id)).toBe('success');
    expect(run).toMatchObject({ taskType: 'SEND_CONNECTION', trigger: 'manual' });
    expect(mock.invitations).toEqual([{ slug: 'rahul-sharma-123', note: 'Hi Rahul, glad to connect!' }]);
    expect(store.lead(rahul.id)!.status).toBe('CONNECTION_SENT');
    expect(store.latestDraft(rahul.id)).toMatchObject({ status: 'sent', note: 'Hi Rahul, glad to connect!' });
    // Other prepared drafts are untouched — nothing is sent in bulk.
    expect(store.listDrafts({ status: 'pending' }).length).toBeGreaterThan(0);
  });

  test('sends without a note, finds Connect in the More menu, and never clicks "People also viewed"', async () => {
    const { byName, mock, store } = await prepared();
    const neha = byName('Neha Gupta'); // Connect only in the More menu
    const run = await confirm(neha, null);
    expect(run.status, logsOf(env, run.id)).toBe('success');
    expect(mock.invitations).toEqual([{ slug: 'neha-gupta', note: null }]);
    expect(store.lead(neha.id)!.status).toBe('CONNECTION_SENT');
  });

  test('already pending → recorded as sent without clicking again', async () => {
    const { byName, mock, store } = await prepared();
    const rahul = byName('Rahul Sharma');
    mock.pending.add('rahul-sharma-123');
    const run = await confirm(rahul, null);
    expect(run.resultMessage).toMatch(/already pending/);
    expect(mock.invitations).toEqual([]);
    expect(store.lead(rahul.id)!.status).toBe('CONNECTION_SENT');
    // A sent lead cannot be confirmed again.
    expect((await api('POST', `/platforms/linkedin/leads/${rahul.id}/confirm-connection`, { confirm: true })).status).toBe(409);
  });

  test('email-required members, follow-only profiles and unconfirmed sends fail with clear messages', async () => {
    const { byName, store, mock } = await prepared({ dropInvite: false });
    const vikram = byName('Vikram Rao');
    let run = await confirm(vikram, null);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'LINKEDIN_EMAIL_REQUIRED' });
    expect(run.error).toMatch(/email address/);
    expect(store.lead(vikram.id)).toMatchObject({ status: 'FAILED' });

    const kiran = byName('Kiran Mehta');
    run = await confirm(kiran, null);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'LINKEDIN_CONNECT_UNAVAILABLE' });

    mock.options.dropInvite = true;
    const ravi = byName('Ravi Kumar');
    run = await confirm(ravi, null);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'LINKEDIN_CONNECTION_NOT_CONFIRMED' });
    expect(store.lead(ravi.id)!.status).toBe('FAILED');
  });

  test('weekly limit and note limit stop the action — nothing is worked around', async () => {
    let { byName, mock } = await prepared({ inviteLimit: true });
    let run = await confirm(byName('Rahul Sharma'), null);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'LINKEDIN_INVITE_LIMIT' });
    expect(mock.invitations).toEqual([]);
    await env.close();

    ({ byName, mock } = await prepared({ noteLimit: true }));
    run = await confirm(byName('Rahul Sharma'), 'Hello!');
    expect(run).toMatchObject({ status: 'failed', errorCode: 'LINKEDIN_NOTE_NOT_ALLOWED' });
    expect(mock.invitations).toEqual([]); // did NOT silently fall back to "send without a note"
  });

  test('connection drafts API: edit note, list, bulk skip (no bulk send exists)', async () => {
    const { byName } = await prepared();
    const rahul = byName('Rahul Sharma');
    const draft = (await api('POST', `/platforms/linkedin/leads/${rahul.id}/connection-draft`, { note: 'Edited note' })).body as ConnectionDraft;
    expect(draft).toMatchObject({ note: 'Edited note', status: 'pending' });
    const list = (await api('GET', '/platforms/linkedin/connection-drafts?status=pending')).body as ConnectionDraft[];
    expect(list.find((d) => d.leadId === rahul.id)?.note).toBe('Edited note');
    const ids = list.slice(0, 2).map((d) => d.leadId);
    expect((await api('POST', '/platforms/linkedin/leads/bulk', { ids, action: 'skip' })).body).toEqual({ updated: 2 });
    expect((await api('POST', '/platforms/linkedin/leads/bulk', { ids, action: 'send' })).status).toBe(400);
    const stats = (await api('GET', '/platforms/linkedin/stats')).body;
    expect(stats).toMatchObject({ skipped: 2, connectionsSent: 0 });
    expect(stats.leadsFound).toBeGreaterThan(2);
  });
});
