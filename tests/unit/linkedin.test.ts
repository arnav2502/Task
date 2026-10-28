import { afterEach, describe, expect, it } from 'vitest';
import type { LeadFinderConfig } from '@shared/types/linkedin';
import { LEAD_FINDER_SCHEMA } from '../../automation-server/src/adapters/linkedin/descriptor';
import { buildSearchUrl, filterLeads, parseDegree, profileReference, renderNote, splitHeadline } from '../../automation-server/src/adapters/linkedin/leadFinder';
import { LinkedInStore, type LeadCard } from '../../automation-server/src/adapters/linkedin/store';
import { HttpError } from '../../automation-server/src/errors/automationError';
import { addLeadTask, addLinkedInAccount, createEnv, type TestEnv } from '../helpers/env';
import { FakeExecutor, fakeServices } from '../helpers/fakeExecutor';

const cfg = (c: Partial<LeadFinderConfig> = {}): LeadFinderConfig => ({ ...(LEAD_FINDER_SCHEMA.parse({ keywords: 'Technical Recruiter' }) as LeadFinderConfig), ...c });
const card = (slug: string, c: Partial<LeadCard> = {}): LeadCard => ({
  profileReference: `/in/${slug}`,
  profileUrl: `https://www.linkedin.com/in/${slug}`,
  name: 'Rahul Sharma',
  headline: 'Technical Recruiter at ABC Technologies',
  jobTitle: 'Technical Recruiter',
  company: 'ABC Technologies',
  location: 'Delhi, India',
  connectionDegree: '2nd',
  ...c,
});

describe('Lead Finder logic', () => {
  it('builds a people-search URL from the free-text filters', () => {
    const u = new URL(
      buildSearchUrl('https://www.linkedin.com', cfg({ industry: 'IT Services', jobTitles: ['Talent Acquisition', 'Recruiter'], companies: ['Tata Consultancy'], schools: ['IIT'] }), 2),
    );
    expect(u.pathname).toBe('/search/results/people/');
    expect(u.searchParams.get('keywords')).toBe('Technical Recruiter IT Services');
    expect(u.searchParams.get('titleFreeText')).toBe('"Talent Acquisition" OR Recruiter');
    expect(u.searchParams.get('company')).toBe('"Tata Consultancy"');
    expect(u.searchParams.get('network')).toBe('["S"]');
    expect(u.searchParams.get('page')).toBe('2');
    expect(new URL(buildSearchUrl('https://x', cfg({ connectionDegree: 'all' }))).searchParams.has('network')).toBe(false);
  });

  it('derives a stable profile reference (the lead identity)', () => {
    expect(profileReference('/in/Rahul-Sharma-123/?miniProfileUrn=abc')).toBe('/in/rahul-sharma-123');
    expect(profileReference('https://www.linkedin.com/in/priya%2Dpatel')).toBe('/in/priya-patel');
    expect(profileReference('/company/acme')).toBeNull();
  });

  it('splits headlines and reads degrees', () => {
    expect(splitHeadline('Technical Recruiter at ABC Technologies')).toEqual({ jobTitle: 'Technical Recruiter', company: 'ABC Technologies' });
    expect(splitHeadline('Talent Acquisition | XYZ')).toEqual({ jobTitle: 'Talent Acquisition', company: null });
    expect(splitHeadline('QA Lead @ Infosys · Pune')).toEqual({ jobTitle: 'QA Lead', company: 'Infosys' });
    expect(parseDegree('• 2nd')).toBe('2nd');
    expect(parseDegree('3rd+')).toBe('3rd');
    expect(parseDegree(null)).toBeNull();
  });

  it('filters by titles, locations, current company, profile keywords and degree; drops duplicates', () => {
    const cards = [
      card('a'),
      card('a'),
      card('b', { headline: 'Engineering Manager at Initech', jobTitle: 'Engineering Manager', company: 'Initech' }),
      card('c', { location: 'London, United Kingdom' }),
      card('d', { connectionDegree: '3rd' }),
      card('e', { headline: 'Technical Recruiter at Infosys — QA hiring', company: 'Infosys' }),
    ];
    expect(filterLeads(cards, cfg({ jobTitles: ['recruiter'], locations: ['india'] })).map((c) => c.profileReference)).toEqual(['/in/a', '/in/e']);
    expect(filterLeads(cards, cfg({ currentCompany: 'infosys', connectionDegree: 'all' })).map((c) => c.profileReference)).toEqual(['/in/e']);
    expect(filterLeads(cards, cfg({ profileKeywords: ['QA'] })).map((c) => c.profileReference)).toEqual(['/in/e']);
  });

  it('renders personalized notes within the 300-character limit', () => {
    const lead = { name: 'Rahul Sharma', jobTitle: 'Technical Recruiter', company: 'ABC Technologies' };
    expect(renderNote('Hi {firstName}, glad to connect about {title} roles at {company}.', lead)).toBe(
      'Hi Rahul, glad to connect about Technical Recruiter roles at ABC Technologies.',
    );
    expect(renderNote('Hello {name} from {company}', { ...lead, company: null })).toBe('Hello Rahul Sharma from your company');
    expect(renderNote('x'.repeat(290) + ' {name}', lead).length).toBeLessThanOrEqual(300);
  });

  it('validates the task configuration', () => {
    expect(() => LEAD_FINDER_SCHEMA.parse({})).toThrow(/keywords or at least one job title/);
    expect(() => LEAD_FINDER_SCHEMA.parse({ keywords: 'x', action: 'prepare_with_note', noteMode: 'none' })).toThrow(/Same note/);
    expect(() => LEAD_FINDER_SCHEMA.parse({ keywords: 'x', noteMode: 'same', note: '' })).toThrow(/Write the connection note/);
    expect(() => LEAD_FINDER_SCHEMA.parse({ keywords: 'x', noteMode: 'same', note: 'y'.repeat(301) })).toThrow(/300/);
    expect(() => LEAD_FINDER_SCHEMA.parse({ keywords: 'x', maxLeads: 500 })).toThrow();
  });
});

describe('LinkedIn store', () => {
  let env: TestEnv;
  afterEach(async () => env?.close());

  it('never duplicates a lead: a second find updates the same record and keeps its status', async () => {
    env = await createEnv({ mock: false });
    const acc = await addLinkedInAccount(env);
    const store = new LinkedInStore(env.services.db.raw);
    const first = store.upsertLead(acc.id, null, card('rahul'), null);
    expect(first.isNew).toBe(true);
    store.setStatus(first.lead.id, 'SKIPPED', 'SKIPPED');
    const again = store.upsertLead(acc.id, null, card('rahul', { location: 'Gurugram, India' }), null);
    expect(again.isNew).toBe(false);
    expect(again.lead).toMatchObject({ id: first.lead.id, status: 'SKIPPED', location: 'Gurugram, India' });
    expect(store.listLeads({ accountId: acc.id }).total).toBe(1);
  });

  it('keeps at most one active draft per lead and counts pending reviews per task', async () => {
    env = await createEnv({ mock: false });
    const acc = await addLinkedInAccount(env);
    const task = addLeadTask(env, acc.id, 'Find recruiters', { keywords: 'Recruiter' });
    const store = new LinkedInStore(env.services.db.raw);
    const { lead } = store.upsertLead(acc.id, task.id, card('rahul'), null);
    const d1 = store.saveDraft(lead.id, task.id, 'Hi');
    const d2 = store.saveDraft(lead.id, task.id, 'Hello');
    expect(d2.id).toBe(d1.id);
    expect(d2.note).toBe('Hello');
    expect(store.pendingCount(task.id)).toBe(1);
    expect(env.services.tasks.view(task.id)).toMatchObject({ state: 'WAITING_FOR_REVIEW', pendingReview: 1, name: 'Find recruiters', typeName: 'Lead Finder', multiInstance: true });
    store.setDraftStatus(d1.id, 'skipped');
    expect(store.saveDraft(lead.id, task.id, null).id).not.toBe(d1.id);
  });
});

describe('LinkedIn tasks and safety rules', () => {
  let env: TestEnv;
  afterEach(async () => env?.close());

  it('LinkedIn is active, needs no stored password, and supports several named Lead Finder tasks', async () => {
    env = await createEnv({ mock: false });
    const acc = await addLinkedInAccount(env);
    expect(acc.hasCredentials).toBe(false);
    expect(env.services.tasks.list({ accountId: acc.id })).toHaveLength(0); // multi-instance: nothing auto-created
    const a = addLeadTask(env, acc.id, 'Find QA Recruiters', { keywords: 'QA Recruiter', locations: ['India'] });
    const b = addLeadTask(env, acc.id, 'Find Hiring Managers', { keywords: 'Hiring Manager' });
    expect(a.state).toBe('DRAFT');
    expect(env.services.tasks.list({ accountId: acc.id }).map((t) => t.name).sort()).toEqual(['Find Hiring Managers', 'Find QA Recruiters']);
    expect(a.configuration).toMatchObject({ keywords: 'QA Recruiter', locations: ['India'], connectionDegree: '2nd', maxLeads: 20 });
    expect(env.services.tasks.update(b.id, { name: 'Find EMs', configuration: { maxLeads: 10 } })).toMatchObject({ name: 'Find EMs', configuration: { maxLeads: 10, keywords: 'Hiring Manager' } });
    env.services.scheduler.create({ taskId: b.id, frequency: 'specific_days', time: '10:00', daysOfWeek: [1, 2, 3, 4, 5] });
    expect(env.services.tasks.view(b.id).state).toBe('SCHEDULED');
    expect(() => env.services.tasks.create({ accountId: acc.id, taskType: 'LEAD_FINDER', name: 'Bad', configuration: { keywords: '' } })).toThrow(/keywords/);
    env.services.tasks.delete(b.id, () => false);
    expect(env.services.db.schedules.list({ taskId: b.id })).toHaveLength(0);
  });

  it('a connection send can only be started by a person (manual/retry) — never by a schedule', async () => {
    env = await createEnv({ mock: false, services: fakeServices() });
    const acc = await addLinkedInAccount(env);
    const action = { type: 'SEND_CONNECTION', payload: { leadId: 1 }, key: '1' };
    expect(() => env.services.executor.enqueue({ accountId: acc.id, action, trigger: 'schedule' })).toThrow(/never by a schedule/);
    expect(() => env.services.executor.enqueue({ accountId: acc.id, action, trigger: 'missed' })).toThrow(HttpError);
    const run = env.services.executor.enqueue({ accountId: acc.id, action, trigger: 'manual' });
    expect(run).toMatchObject({ taskType: 'SEND_CONNECTION', taskName: 'Send connection request', maxAttempts: 1, taskId: null });
    expect(() => env.services.executor.enqueue({ accountId: acc.id, action, trigger: 'manual' })).toThrow(/already queued/);
    await env.services.executor.queue.idle();
  });

  it('a Lead Finder run that prepared drafts ends WAITING_FOR_REVIEW with a "Review now" notification', async () => {
    env = await createEnv({ mock: false, services: fakeServices() });
    const acc = await addLinkedInAccount(env);
    const task = addLeadTask(env, acc.id, 'Find recruiters', { keywords: 'Recruiter' });
    (env.services.executor as FakeExecutor).behaviour = async () => ({
      message: '24 lead(s) found · 8 connection candidate(s) prepared',
      review: { pending: 8, title: 'LinkedIn task completed — review needed', message: '24 leads found · 8 ready for review', link: '#/platforms/linkedin/drafts' },
    });
    const run = await env.services.executor.waitFor(env.services.executor.enqueue({ taskId: task.id, trigger: 'schedule' }).id, 5000);
    expect(run).toMatchObject({ status: 'waiting_for_review', reviewCount: 8 });
    expect(env.services.db.notifications.list()[0]).toMatchObject({ type: 'ACTION_REQUIRED', link: '#/platforms/linkedin/drafts' });
    expect(env.services.dashboard.dashboard().stats.successfulToday).toBe(1);
  });
});
