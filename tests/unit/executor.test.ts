import { afterEach, describe, expect, it } from 'vitest';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { AutomationError } from '../../automation-server/src/errors/automationError';
import { naukriError } from '../../automation-server/src/adapters/naukri/errors';
import { HttpError } from '../../automation-server/src/errors/automationError';
import { addNaukriAccount, createEnv, sleep, taskOf, waitForRun, type TestEnv } from '../helpers/env';
import { FakeExecutor, fakeServices } from '../helpers/fakeExecutor';

let env: TestEnv;
const exec = () => env.services.executor as FakeExecutor;
afterEach(async () => env?.close());

async function setup(settings = {}) {
  env = await createEnv({ mock: false, services: fakeServices(), settings: { maxRetries: 1, ...settings } });
  const a = await addNaukriAccount(env, 'Personal', 'me@example.com');
  return { account: a, profile: taskOf(env, a.id), share: taskOf(env, a.id, NAUKRI_TASKS.SHARE_INTEREST) };
}

describe('TaskExecutor', () => {
  it('runs a task: RUN id, stages, success, task counters, success notification', async () => {
    const { profile } = await setup();
    const run = env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    expect(run.id).toMatch(/^RUN-\d{8}-\d{6}$/);
    expect(run.status).toBe('queued');
    const done = await waitForRun(env, run.id);
    expect(done.status).toBe('success');
    expect(done.stage).toBe('COMPLETED');
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
    const details = env.services.dashboard.runDetails(run.id);
    expect(details.timeline.map((t) => `${t.stage}:${t.state}`)).toEqual([
      'STARTED:done',
      'LOGIN_CHECK:done',
      'TASK_EXECUTION:done',
      'VERIFICATION:skipped',
      'COMPLETED:done',
    ]);
    const task = env.services.tasks.view(profile.id);
    expect(task).toMatchObject({ successCount: 1, failureCount: 0, lastStatus: 'success', lastRunId: run.id });
    expect(env.services.db.notifications.list()[0]).toMatchObject({ type: 'SUCCESS', title: 'Naukri profile updated successfully.' });
  });

  it('assigns increasing run ids', async () => {
    const { profile, share } = await setup();
    const a = env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    const b = env.services.executor.enqueue({ taskId: share.id, trigger: 'manual' });
    expect(Number(b.id.slice(-6))).toBe(Number(a.id.slice(-6)) + 1);
    await env.services.executor.queue.idle();
  });

  it('retries temporary failures, then succeeds', async () => {
    const { profile } = await setup();
    exec().behaviour = async ({ attempt }) => {
      if (attempt === 1) throw new AutomationError('ELEMENT_NOT_FOUND', 'flaky');
      return { message: 'ok' };
    };
    const done = await waitForRun(env, env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' }).id);
    expect(done.status).toBe('success');
    expect(done.attempt).toBe(2);
  });

  it('never retries non-retryable errors', async () => {
    const { profile } = await setup({ maxRetries: 3 });
    exec().behaviour = async () => {
      throw new AutomationError('INVALID_CREDENTIALS', 'Login failed: wrong password');
    };
    const run = env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    const done = await waitForRun(env, run.id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'INVALID_CREDENTIALS', attempt: 1 });
    expect(exec().attempts.get(run.id)).toBe(1);
    // generic category → account status + ERROR notification
    expect(env.services.accounts.get(profile.accountId).status).toBe('login_failed');
    expect(env.services.db.notifications.list()[0]).toMatchObject({ type: 'ERROR', title: 'Naukri profile update failed.' });
  });

  it('does not retry tasks whose type is not retryable (Share Interest)', async () => {
    const { share } = await setup({ maxRetries: 3 });
    exec().behaviour = async () => {
      throw new AutomationError('TIMEOUT', 'slow');
    };
    const run = env.services.executor.enqueue({ taskId: share.id, trigger: 'manual' });
    expect(run.maxAttempts).toBe(1);
    expect((await waitForRun(env, run.id)).status).toBe('failed');
  });

  it('platform errors keep their own code and use their category rules', async () => {
    const { profile } = await setup({ maxRetries: 2 });
    exec().behaviour = async () => {
      throw naukriError('RESUME_NOT_FOUND', 'No PDF');
    };
    const run = env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    const done = await waitForRun(env, run.id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'NAUKRI_RESUME_NOT_FOUND' });
    expect(exec().attempts.get(run.id)).toBe(1);
  });

  it('OTP / CAPTCHA end the run as action_required with an ACTION_REQUIRED notification', async () => {
    const { profile } = await setup();
    exec().behaviour = async () => {
      throw new AutomationError('OTP_REQUIRED', 'Naukri asked for OTP verification');
    };
    const done = await waitForRun(env, env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' }).id);
    expect(done.status).toBe('action_required');
    expect(env.services.accounts.get(profile.accountId).status).toBe('action_required');
    expect(env.services.db.notifications.list()[0]?.type).toBe('ACTION_REQUIRED');
  });

  it('enforces the per-task timeout', async () => {
    const { profile } = await setup({ retryEnabled: false, taskTimeoutSec: 30 });
    exec().timeoutFor = () => 0.3;
    exec().behaviour = async ({ ctx }) => {
      await ctx.sleep(5000);
      return { message: 'late' };
    };
    const done = await waitForRun(env, env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' }).id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
  });

  it('cancels a running job and a queued job', async () => {
    const { profile, share } = await setup();
    exec().behaviour = async ({ ctx }) => {
      await ctx.sleep(10_000);
      return { message: 'never' };
    };
    const running = env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    const queued = env.services.executor.enqueue({ taskId: share.id, trigger: 'manual' }); // same account → waits
    await sleep(100);
    expect(env.services.executor.cancel(queued.id)).toBe(true);
    expect(env.services.executor.cancel(running.id)).toBe(true);
    expect((await waitForRun(env, running.id)).status).toBe('cancelled');
    expect((await waitForRun(env, queued.id)).status).toBe('cancelled');
    expect(exec().attempts.has(queued.id)).toBe(false);
  });

  it('rejects a duplicate of a queued or running task (409)', async () => {
    const { profile } = await setup();
    exec().behaviour = async ({ ctx }) => {
      await ctx.sleep(300);
      return { message: 'ok' };
    };
    env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' });
    expect(() => env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' })).toThrow(HttpError);
    await env.services.executor.queue.idle();
  });

  it('runs different accounts in parallel up to the limit, one job per account', async () => {
    env = await createEnv({ mock: false, services: fakeServices(), settings: { maxConcurrent: 2 } });
    const accounts = await Promise.all(['a', 'b', 'c'].map((n) => addNaukriAccount(env, n, `${n}@example.com`)));
    exec().behaviour = async ({ ctx }) => {
      await ctx.sleep(150);
      return { message: 'ok' };
    };
    for (const a of accounts) {
      env.services.executor.enqueue({ taskId: taskOf(env, a.id).id, trigger: 'schedule' });
      env.services.executor.enqueue({ taskId: taskOf(env, a.id, NAUKRI_TASKS.RESUME_UPLOAD).id, trigger: 'schedule' });
    }
    await env.services.executor.queue.idle();
    expect(exec().maxActive).toBe(2);
    for (const a of accounts) {
      const mine = exec().timeline.filter((t) => t.accountId === a.id).sort((x, y) => x.start - y.start);
      expect(mine).toHaveLength(2);
      expect(mine[1]!.start).toBeGreaterThanOrEqual(mine[0]!.end);
    }
  });

  it('retries a finished run as a new run linked to the original', async () => {
    const { profile } = await setup();
    const first = await waitForRun(env, env.services.executor.enqueue({ taskId: profile.id, trigger: 'manual' }).id);
    const again = env.services.executor.retry(first.id);
    expect(again).toMatchObject({ trigger: 'retry', retryOf: first.id, taskId: profile.id });
    await waitForRun(env, again.id);
  });

  it('fails a task with an invalid stored configuration without running it', async () => {
    const { share } = await setup();
    env.services.db.tasks.setConfig('naukri', NAUKRI_TASKS.SHARE_INTEREST, share.accountId, { rolesPerRun: 999 });
    const run = env.services.executor.enqueue({ taskId: share.id, trigger: 'manual' });
    const done = await waitForRun(env, run.id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'CONFIG_INVALID' });
    expect(exec().attempts.has(run.id)).toBe(false);
  });

  it('supports account-level system tasks (Test login) through the same queue', async () => {
    const { account } = await setup();
    const run = env.services.executor.enqueue({ accountId: account.id, systemTask: 'TEST_LOGIN', trigger: 'manual' });
    expect(run).toMatchObject({ taskId: null, taskType: 'TEST_LOGIN', taskName: 'Test login' });
    expect((await waitForRun(env, run.id)).status).toBe('success');
  });
});
