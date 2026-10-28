import { afterEach, describe, expect, it } from 'vitest';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { MISSED_GRACE_MS } from '../../automation-server/src/scheduler/scheduler';
import { addNaukriAccount, createEnv, taskOf, type TestEnv } from '../helpers/env';
import { FakeExecutor, fakeServices } from '../helpers/fakeExecutor';

let env: TestEnv;
afterEach(async () => env?.close());

async function setup(settings = {}) {
  env = await createEnv({ mock: false, services: fakeServices(), settings });
  const account = await addNaukriAccount(env, 'Personal', 'me@example.com');
  return { account, task: taskOf(env, account.id) };
}

const runsOf = (taskId: string) => env.services.db.runs.list({ taskId }).runs;

describe('Scheduler', () => {
  it('creates schedules with platform/account/task ids, a summary and nextRunAt', async () => {
    const { task } = await setup();
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '9:05' });
    expect(s).toMatchObject({ platformId: 'naukri', accountId: task.accountId, taskId: task.id, time: '09:05', summary: 'Daily at 9:05 AM', enabled: true });
    expect(Date.parse(s.nextRunAt!)).toBeGreaterThan(Date.now());
    expect(env.services.tasks.view(task.id).nextRunAt).toBe(s.nextRunAt);
  });

  it('rejects invalid schedules', async () => {
    const { task } = await setup();
    expect(() => env.services.scheduler.create({ taskId: task.id, frequency: 'weekly', time: '09:00', daysOfWeek: [] })).toThrow(/exactly one day/);
    expect(() => env.services.scheduler.create({ taskId: task.id, frequency: 'once', time: '09:00', onceDate: '2001-01-01' })).toThrow(/past/);
  });

  it('fires due schedules and advances nextRunAt', async () => {
    const { task } = await setup();
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    const due = new Date(Date.parse(s.nextRunAt!) + 1000);
    env.services.scheduler.tick(due);
    await env.services.executor.queue.idle();
    expect(runsOf(task.id).map((r) => `${r.trigger}:${r.status}`)).toEqual(['schedule:success']);
    const after = env.services.db.schedules.get(s.id)!;
    expect(Date.parse(after.nextRunAt!)).toBeGreaterThan(due.getTime());
    expect(after.lastRunAt).toBe(due.toISOString());
  });

  it('missed runs: "skip" records a skipped run', async () => {
    const { task } = await setup({ missedPolicy: 'skip' });
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    env.services.scheduler.tick(new Date(Date.parse(s.nextRunAt!) + MISSED_GRACE_MS + 60_000));
    const [run] = runsOf(task.id);
    expect(run).toMatchObject({ trigger: 'missed', status: 'skipped' });
    expect(run?.resultMessage).toMatch(/Missed/);
  });

  it('missed runs: "run" postpones 2–6 minutes, then runs with trigger "missed"', async () => {
    const { task } = await setup({ missedPolicy: 'run' });
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    const late = new Date(Date.parse(s.nextRunAt!) + 3_600_000);
    env.services.scheduler.tick(late);
    expect(runsOf(task.id)).toHaveLength(0);
    const deferred = Date.parse(env.services.db.schedules.get(s.id)!.nextRunAt!) - late.getTime();
    expect(deferred).toBeGreaterThanOrEqual(2 * 60_000);
    expect(deferred).toBeLessThanOrEqual(6 * 60_000);
    env.services.scheduler.tick(new Date(late.getTime() + 7 * 60_000));
    await env.services.executor.queue.idle();
    expect(runsOf(task.id).map((r) => r.trigger)).toEqual(['missed']);
  });

  it('a once schedule fires once and disables itself', async () => {
    const { task } = await setup();
    const tomorrow = new Date(Date.now() + 86_400_000);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'once', time: '08:00', onceDate: date });
    env.services.scheduler.tick(new Date(Date.parse(s.nextRunAt!) + 1000));
    await env.services.executor.queue.idle();
    expect(env.services.db.schedules.get(s.id)).toMatchObject({ enabled: false, nextRunAt: null });
    expect(runsOf(task.id)).toHaveLength(1);
  });

  it('does not run schedules of a paused task or account', async () => {
    const { task, account } = await setup();
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    env.services.tasks.update(task.id, { enabled: false });
    env.services.scheduler.tick(new Date(Date.parse(s.nextRunAt!) + 1000));
    await env.services.accounts.update(account.id, { enabled: false });
    env.services.tasks.update(task.id, { enabled: true });
    env.services.scheduler.tick(new Date(Date.parse(env.services.db.schedules.get(s.id)!.nextRunAt!) + 1000));
    expect(runsOf(task.id)).toHaveLength(0);
  });

  it('records a skipped run when the task is still running (duplicate prevention)', async () => {
    const { task } = await setup();
    const exec = env.services.executor as FakeExecutor;
    exec.behaviour = async ({ ctx }) => {
      await ctx.sleep(400);
      return { message: 'ok' };
    };
    env.services.executor.enqueue({ taskId: task.id, trigger: 'manual' });
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    env.services.scheduler.tick(new Date(Date.parse(s.nextRunAt!) + 1000));
    expect(runsOf(task.id).find((r) => r.trigger === 'schedule')).toMatchObject({ status: 'skipped' });
    await env.services.executor.queue.idle();
  });

  it('hourly: the next slot comes from the next hour after firing', async () => {
    const { task } = await setup();
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'hourly', time: '00:00', windowEnd: '23:00', randomMinute: true });
    const fireAt = new Date(Date.parse(s.nextRunAt!) + 1000);
    env.services.scheduler.tick(fireAt);
    await env.services.executor.queue.idle();
    const next = new Date(env.services.db.schedules.get(s.id)!.nextRunAt!);
    expect(next.getTime()).toBeGreaterThan(new Date(fireAt).setMinutes(59, 59, 999));
    expect(next.getMinutes()).toBeGreaterThanOrEqual(1);
  });

  it('pauses while Chrome is closed when "Run only while Chrome is open" is on', async () => {
    const { task } = await setup({ requireChromeOpen: true });
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    const due = new Date(Date.parse(s.nextRunAt!) + 1000);
    env.services.scheduler.tick(due);
    expect(runsOf(task.id)).toHaveLength(0);
    env.services.scheduler.chromeHeartbeat();
    env.services.scheduler.tick(due);
    await env.services.executor.queue.idle();
    expect(runsOf(task.id)).toHaveLength(1);
  });

  it('is platform independent: schedules reference tasks only by id', async () => {
    const { account } = await setup();
    const share = taskOf(env, account.id, NAUKRI_TASKS.SHARE_INTEREST);
    const s = env.services.scheduler.create({ taskId: share.id, frequency: 'specific_days', time: '10:00', daysOfWeek: [5, 1, 1] });
    expect(s).toMatchObject({ taskType: NAUKRI_TASKS.SHARE_INTEREST, daysOfWeek: [1, 5] });
  });
});
