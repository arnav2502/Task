import { afterEach, describe, expect, it } from 'vitest';
import { NaukriStore } from '../../automation-server/src/adapters/naukri/store';
import { BrowserManager } from '../../automation-server/src/browser/browserManager';
import { toAutomationError } from '../../automation-server/src/errors/automationError';
import { computeNextRun } from '../../automation-server/src/scheduler/scheduleMath';
import { addNaukriAccount, createEnv, makeTempDir, taskOf, type TestEnv } from '../helpers/env';
import { FakeExecutor, fakeServices } from '../helpers/fakeExecutor';

/** Regressions for issues found in code review. */
let env: TestEnv | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

describe('review regressions', () => {
  it('a Share Interest click with an unknown outcome stays "pending" and is never retried', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const store = new NaukriStore(env.services.db.raw);
    const role = { jobId: '42', title: 'QA', company: null, experience: null, salary: null, location: null };
    const id = store.record(a.id, role, 'pending', null, null);
    expect(store.attemptedJobIds(a.id).has('42')).toBe(true);
    expect(store.countSharedSince(a.id, new Date(0).toISOString())).toBe(0);
    store.settle(id, 'shared', null);
    expect(store.list(a.id, 5)[0]?.status).toBe('shared');
  });

  it('closing a session before its browser launches never starts a browser', async () => {
    const s = new BrowserManager().createSession('x', makeTempDir('profile'), 'headless');
    await s.close();
    await expect(s.page()).rejects.toMatchObject({ category: 'CANCELLED' });
  });

  it('a crashed / closed browser is a failure, not a silent cancel', () => {
    expect(toAutomationError(new Error('Target page, context or browser has been closed')).category).toBe('TASK_FAILED');
  });

  it('a timed-out attempt is aborted (its signal fires) instead of running on', async () => {
    env = await createEnv({ mock: false, services: fakeServices(), settings: { retryEnabled: false } });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const exec = env.services.executor as FakeExecutor;
    exec.timeoutFor = () => 0.2;
    let abortedSeen = false;
    exec.behaviour = async ({ ctx }) => {
      await new Promise((r) => setTimeout(r, 500)); // ignores cancellation
      abortedSeen = ctx.signal.aborted;
      return { message: 'late' };
    };
    const run = env.services.executor.enqueue({ taskId: taskOf(env, a.id).id, trigger: 'manual' });
    expect((await env.services.executor.waitFor(run.id, 5000)).errorCode).toBe('TIMEOUT');
    await new Promise((r) => setTimeout(r, 500));
    expect(abortedSeen).toBe(true);
  });

  it('hourly window with random minute never runs before the start minute', () => {
    const s = { frequency: 'hourly' as const, time: '09:30', windowEnd: '12:00', daysOfWeek: [], onceDate: null, randomMinute: true };
    expect(computeNextRun(s, new Date(2026, 9, 26, 8, 0), (lo) => lo)).toEqual(new Date(2026, 9, 26, 9, 30));
  });

  it('a late tick does not skip the following hourly slot', async () => {
    env = await createEnv({ mock: false, services: fakeServices() });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const task = taskOf(env, a.id);
    const s = env.services.scheduler.create({ taskId: task.id, frequency: 'hourly', time: '00:00', windowEnd: '23:00', randomMinute: false });
    const due = new Date(s.nextRunAt!);
    if (due.getHours() >= 23) return; // no "next hour" left today in this window — nothing to assert
    env.services.scheduler.tick(new Date(due.getTime() + 90_000)); // fired 1.5 min late (within grace)
    await env.services.executor.queue.idle();
    const next = new Date(env.services.db.schedules.get(s.id)!.nextRunAt!);
    expect(next.getHours()).toBe(due.getHours() + 1);
  });
});
