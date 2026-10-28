import { expect, test } from '@playwright/test';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { NaukriStore } from '../../automation-server/src/adapters/naukri/store';
import { addNaukriAccount, createEnv, logsOf, taskOf, waitForRun, type TestEnv } from '../helpers/env';

/** Share Interest = job applications. These tests prove the limits and the never-twice guarantee. */
let env: TestEnv;
test.afterEach(async () => env?.close());

const FAST = { minDelaySec: 5, maxDelaySec: 5 };

async function share(accountId: string, config: Record<string, unknown>) {
  const task = taskOf(env, accountId, NAUKRI_TASKS.SHARE_INTEREST);
  env.services.tasks.update(task.id, { configuration: { ...FAST, ...config } });
  const r = env.services.executor.enqueue({ taskId: task.id, trigger: 'manual' });
  return waitForRun(env, r.id, 170_000);
}

test('shares up to "roles per run", records each role, and never shares a role twice', async () => {
  env = await createEnv();
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  const first = await share(a.id, { rolesPerRun: 2 });
  expect(first.status, logsOf(env, first.id)).toBe('success');
  expect(first.result).toMatchObject({ found: 5, shared: 2, failed: 0 });
  const appliedFirst = env.mock!.applied.get('me@example.com')!;
  expect(appliedFirst).toHaveLength(2);

  const second = await share(a.id, { rolesPerRun: 2 });
  const all = env.mock!.applied.get('me@example.com')!;
  expect(all).toHaveLength(4);
  expect(new Set(all).size).toBe(4);
  expect(second.result).toMatchObject({ shared: 2 });
  const store = new NaukriStore(env.services.db.raw);
  expect(store.list(a.id, 50).filter((j) => j.status === 'shared')).toHaveLength(4);
});

test('include / exclude keywords decide which roles are shared', async () => {
  env = await createEnv();
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  const r = await share(a.id, { rolesPerRun: 10, includeKeywords: ['qa', 'playwright'], excludeKeywords: ['senior'] });
  expect(r.status).toBe('success');
  const titles = new NaukriStore(env.services.db.raw).list(a.id, 50).map((j) => j.title).sort();
  expect(titles).toEqual(['QA Engineer', 'QA Engineer', 'Software Dev Test Engineer']);
});

test('stops at the daily limit', async () => {
  env = await createEnv();
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  await share(a.id, { rolesPerRun: 2, dailyLimit: 3 });
  const second = await share(a.id, { rolesPerRun: 2, dailyLimit: 3 });
  expect(second.result).toMatchObject({ shared: 1 });
  const third = await share(a.id, { rolesPerRun: 2, dailyLimit: 3 });
  expect(third.resultMessage).toMatch(/Daily limit reached/);
  expect(env.mock!.applied.get('me@example.com')).toHaveLength(3);
});

test('a per-role rejection (HTTP 200 with code 409) is recorded as failed, not shared', async () => {
  env = await createEnv({ mock: { failApplyFor: ['190826901155', '190826901156', '190826901157', '190826901158', '190826901159'] } });
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  const r = await share(a.id, { rolesPerRun: 1 });
  expect(r).toMatchObject({ status: 'failed', errorCode: 'NAUKRI_SHARE_FAILED', attempt: 1 });
  const [job] = new NaukriStore(env.services.db.raw).list(a.id, 5);
  expect(job).toMatchObject({ status: 'failed', message: 'Naukri returned status 409' });
});

test('an empty listing is a success with nothing to do', async () => {
  env = await createEnv();
  env.mock!.roles = [];
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  const r = await share(a.id, {});
  expect(r.status).toBe('success');
  expect(r.resultMessage).toMatch(/No Early access roles/);
});

test('dashboard reports today’s applications for Naukri', async () => {
  env = await createEnv();
  const a = await addNaukriAccount(env, 'P', 'me@example.com');
  await share(a.id, { rolesPerRun: 2 });
  const naukri = env.services.dashboard.dashboard().platforms.find((p) => p.platformId === 'naukri')!;
  expect(naukri.metrics.find((m) => m.key === 'applications')?.value).toBe(2);
});
