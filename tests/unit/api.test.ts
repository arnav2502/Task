import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWebSocket, createApp } from '../../automation-server/src/server/app';
import { createEnv, type TestEnv } from '../helpers/env';
import { fakeServices } from '../helpers/fakeExecutor';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const OTHER_EXT = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';

let env: TestEnv;
let server: http.Server;
let port: number;
let token: string;

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: http.IncomingHttpHeaders;
}

/** Raw HTTP so tests can forge Host / Origin headers exactly like a hostile page would. */
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; auth?: boolean } = {}): Promise<Res> {
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, ...opts.headers };
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  if (data) headers['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeEach(async () => {
  env = await createEnv({ mock: false, services: fakeServices() });
  const created = createApp(env.services);
  server = http.createServer(created.app);
  attachWebSocket(server, env.services, created.token);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
  token = '';
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await env.close();
});

async function pair() {
  const res = await call('POST', '/pair', { headers: { Origin: EXT }, auth: false });
  token = res.body.token;
  return res;
}

describe('API security', () => {
  it('health is public; everything else needs the bearer token', async () => {
    expect((await call('GET', '/health', { auth: false })).body).toMatchObject({ ok: true, name: 'TaskPilot', paired: false, platforms: 6 });
    expect((await call('GET', '/dashboard', { auth: false })).status).toBe(401);
    expect((await call('GET', '/dashboard', { headers: { Authorization: 'Bearer wrong' }, auth: false })).status).toBe(401);
  });

  it('pairs the first extension only; websites and other extensions are refused', async () => {
    expect((await call('POST', '/pair', { auth: false })).status).toBe(403);
    expect((await call('POST', '/pair', { headers: { Origin: 'https://evil.example' }, auth: false })).status).toBe(403);
    const first = await pair();
    expect(first.status).toBe(200);
    expect(typeof first.body.token).toBe('string');
    expect((await call('POST', '/pair', { headers: { Origin: OTHER_EXT }, auth: false })).status).toBe(403);
    expect((await call('POST', '/pair', { headers: { Origin: EXT }, auth: false })).body.token).toBe(token);
    expect((await call('GET', '/dashboard')).status).toBe(200);
  });

  it('honours a pinned extension id', async () => {
    env.services.config.allowedExtensionId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const created = createApp(env.services);
    const s2 = http.createServer(created.app);
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', () => r()));
    const p2 = (s2.address() as AddressInfo).port;
    const old = port;
    port = p2;
    expect((await call('POST', '/pair', { headers: { Origin: EXT }, auth: false })).status).toBe(403);
    expect((await call('POST', '/pair', { headers: { Origin: OTHER_EXT }, auth: false })).status).toBe(200);
    port = old;
    s2.closeAllConnections();
    await new Promise((r) => s2.close(r));
  });

  it('blocks DNS rebinding with a Host-header check', async () => {
    await pair();
    expect((await call('GET', '/health', { headers: { Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call('GET', '/health', { headers: { Host: `localhost:${port}` } })).status).toBe(200);
  });

  it('sends CORS headers only to extension origins', async () => {
    await pair();
    const ok = await call('OPTIONS', '/dashboard', { headers: { Origin: EXT, 'Access-Control-Request-Method': 'GET' } });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(EXT);
    const bad = await call('GET', '/dashboard', { headers: { Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('WebSocket needs the token and an extension origin', async () => {
    await pair();
    const open = (url: string, origin?: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(url, origin ? { origin } : {});
        ws.on('open', () => {
          ws.close();
          resolve('open');
        });
        ws.on('error', () => resolve('refused'));
        ws.on('unexpected-response', () => resolve('refused'));
      });
    expect(await open(`ws://127.0.0.1:${port}/ws?token=wrong`, EXT)).toBe('refused');
    expect(await open(`ws://127.0.0.1:${port}/ws?token=${token}`, 'https://evil.example')).toBe('refused');
    expect(await open(`ws://127.0.0.1:${port}/ws?token=${token}`, EXT)).toBe('open');
  });

  it('streams live updates over the WebSocket', async () => {
    await pair();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { origin: EXT });
    await new Promise((r) => ws.on('open', r));
    const got: string[] = [];
    ws.on('message', (m) => got.push(JSON.parse(String(m)).type));
    await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'A', username: 'a@example.com', password: 'pw-123' } });
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    expect(got).toContain('account:update');
    expect(got).toContain('tasks:changed');
  });
});

describe('API behaviour', () => {
  beforeEach(pair);

  it('validates input with clear 400 messages', async () => {
    const r = await call('POST', '/accounts', { body: { platformId: 'naukri', name: '', username: 'x' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/name/i);
    expect((await call('PUT', '/settings', { body: { maxConcurrent: 99 } })).status).toBe(400);
    expect((await call('PUT', '/settings', { body: { unknownSetting: true } })).status).toBe(400);
    expect((await call('GET', '/runs?status=bogus')).status).toBe(400);
  });

  it('accounts: create, list masked, coming-soon 409, never echoes the password', async () => {
    const created = await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'Personal', username: 'person@example.com', password: 'Hunter#22' } });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('Hunter#22');
    expect(created.body.username).toBe('pe****@example.com');
    const list = await call('GET', '/accounts');
    expect(list.body[0]).toMatchObject({ name: 'Personal', taskCount: 3, enabledTaskCount: 3 });
    expect(JSON.stringify(list.body)).not.toContain('person@example.com');
    expect((await call('POST', '/accounts', { body: { platformId: 'indeed', name: 'I', username: 'i@example.com', password: 'x' } })).status).toBe(409);
  });

  it('tasks: dynamic list from the adapter, config validated by the adapter, run → 202 and 409 on duplicate', async () => {
    const acc = (await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'P', username: 'p@example.com', password: 'pw-123' } })).body;
    const tasks = (await call('GET', `/tasks?accountId=${acc.id}`)).body;
    expect(tasks.map((t: { name: string }) => t.name)).toEqual(['Profile Update', 'Resume Upload', 'Share Interest']);
    const share = tasks.find((t: { taskType: string }) => t.taskType === 'SHARE_INTEREST');
    expect((await call('PUT', `/tasks/${share.id}`, { body: { configuration: { rolesPerRun: 0 } } })).status).toBe(400);
    expect((await call('PUT', `/tasks/${share.id}`, { body: { configuration: { minDelaySec: 60, maxDelaySec: 10 } } })).body.error).toMatch(/maximum delay/);
    const updated = await call('PUT', `/tasks/${share.id}`, { body: { configuration: { rolesPerRun: 3, includeKeywords: ['QA'] } } });
    expect(updated.body).toMatchObject({ hasConfigOverride: true, configuration: { rolesPerRun: 3, includeKeywords: ['QA'], dailyLimit: 25 } });
    expect((await call('PUT', `/tasks/${share.id}`, { body: { resetConfiguration: true } })).body.configuration.rolesPerRun).toBe(5);

    const run = await call('POST', `/tasks/${share.id}/run`, { body: {} });
    expect(run.status).toBe(202);
    expect(run.body.id).toMatch(/^RUN-/);
    expect(run.body).not.toHaveProperty('screenshotPath');
    expect(run.body).not.toHaveProperty('logPath');
    await env.services.executor.queue.idle();
    const details = await call('GET', `/runs/${run.body.id}`);
    expect(details.body.status).toBe('success');
    expect(details.body.logs.length).toBeGreaterThan(0);
    expect(details.body.timeline).toHaveLength(5);
    const page = await call('GET', `/runs?platformId=naukri&taskType=SHARE_INTEREST&trigger=manual`);
    expect(page.body.total).toBe(1);
  });

  it('platform defaults apply to every account unless overridden', async () => {
    const acc = (await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'P', username: 'p@example.com', password: 'pw-123' } })).body;
    const res = await call('PUT', '/platforms/naukri/tasks/RESUME_UPLOAD/config', { body: { configuration: { folderPath: 'C:\\Resumes' } } });
    expect(res.body.configuration).toEqual({ folderPath: 'C:\\Resumes', selectionMode: 'latest', specificFile: '' });
    const tasks = (await call('GET', `/tasks?accountId=${acc.id}`)).body;
    expect(tasks.find((t: { taskType: string }) => t.taskType === 'RESUME_UPLOAD').configuration.folderPath).toBe('C:\\Resumes');
    expect((await call('GET', '/platforms/linkedin/tasks/X/config')).status).toBe(404);
  });

  it('schedules CRUD', async () => {
    const acc = (await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'P', username: 'p@example.com', password: 'pw-123' } })).body;
    const task = (await call('GET', `/tasks?accountId=${acc.id}`)).body[0];
    const created = await call('POST', '/schedules', { body: { taskId: task.id, frequency: 'hourly', time: '07:00', windowEnd: '23:00', randomMinute: true } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ platformId: 'naukri', accountId: acc.id, summary: 'Hourly 7 AM–11 PM daily, random minute' });
    expect((await call('PUT', `/schedules/${created.body.id}`, { body: { enabled: false } })).body).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await call('GET', `/schedules?taskId=${task.id}`)).body).toHaveLength(1);
    expect((await call('DELETE', `/schedules/${created.body.id}`)).status).toBe(204);
    expect((await call('POST', '/schedules', { body: { taskId: task.id, frequency: 'daily', time: '9am' } })).status).toBe(400);
  });

  it('platforms, dashboard, queue, notifications', async () => {
    const platforms = (await call('GET', '/platforms')).body;
    expect(platforms.map((p: { id: string; status: string }) => `${p.id}:${p.status}`)).toEqual([
      'naukri:active',
      'linkedin:active',
      'indeed:coming_soon',
      'glassdoor:coming_soon',
      'career-portals:coming_soon',
      'custom:coming_soon',
    ]);
    expect((await call('GET', '/platforms/indeed')).body.plannedTasks).toContain('Track applications');
    const dash = (await call('GET', '/dashboard')).body;
    expect(dash.platforms).toHaveLength(6);
    expect(dash.stats).toMatchObject({ totalTasks: 0, totalAccounts: 0 });
    expect((await call('GET', '/queue')).body).toMatchObject({ running: [], pending: [] });
    env.services.notifications.notify({ type: 'INFO', title: 'Hello', message: 'World' });
    const n = (await call('GET', '/notifications')).body;
    expect(n.unread).toBe(1);
    expect((await call('POST', '/notifications/read', { body: { all: true } })).body.unread).toBe(0);
  });

  it('serves run files only from inside the logs folder', async () => {
    const acc = (await call('POST', '/accounts', { body: { platformId: 'naukri', name: 'P', username: 'p@example.com', password: 'pw-123' } })).body;
    const task = (await call('GET', `/tasks?accountId=${acc.id}`)).body[0];
    const run = (await call('POST', `/tasks/${task.id}/run`, { body: {} })).body;
    await env.services.executor.queue.idle();
    env.services.db.runs.update(run.id, { screenshotPath: 'C:\\Windows\\win.ini' });
    expect((await call('GET', `/runs/${run.id}/screenshot`)).status).toBe(404);
    expect((await call('GET', `/runs/${run.id}/log`)).status).toBe(200);
  });

  it('naukri routes are mounted for the active platform only', async () => {
    expect((await call('GET', '/platforms/naukri/shared-jobs')).body).toEqual({ jobs: [], sharedToday: {} });
    expect((await call('GET', '/platforms/naukri/resume/scan')).body.error).toMatch(/No resume folder/);
    expect((await call('GET', '/platforms/linkedin/shared-jobs')).status).toBe(404);
  });
});
