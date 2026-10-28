import { describe, expect, it } from 'vitest';
import { JobQueue, type Job } from '../../automation-server/src/queue/jobQueue';

let seq = 0;
const job = (accountId: string, priority = 50, dedupeKey = `${accountId}:${++seq}`): Job => ({
  runId: `run-${++seq}`,
  platformId: 'naukri',
  accountId,
  dedupeKey,
  taskType: 'T',
  trigger: 'manual',
  mode: 'headless',
  priority,
  enqueuedAt: seq,
  abort: new AbortController(),
});

/** A queue whose jobs finish only when the test releases them. */
function harness(max = 2) {
  const started: Job[] = [];
  const release = new Map<string, () => void>();
  const q = new JobQueue(
    (j) =>
      new Promise<void>((resolve) => {
        started.push(j);
        release.set(j.runId, resolve);
        j.abort.signal.addEventListener('abort', () => resolve());
      }),
    () => max,
  );
  const finish = async (j: Job) => {
    release.get(j.runId)?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { q, started, finish };
}

describe('JobQueue', () => {
  it('respects the concurrency limit', () => {
    const { q, started } = harness(2);
    [job('a'), job('b'), job('c')].forEach((j) => q.enqueue(j));
    expect(started.map((j) => j.accountId)).toEqual(['a', 'b']);
    expect(q.size).toEqual({ pending: 1, running: 2 });
  });

  it('never runs two jobs of the same account at once', async () => {
    const { q, started, finish } = harness(3);
    const a1 = job('a');
    const a2 = job('a');
    const b1 = job('b');
    [a1, a2, b1].forEach((j) => q.enqueue(j));
    expect(started.map((j) => j.runId)).toEqual([a1.runId, b1.runId]);
    await finish(a1);
    expect(started.map((j) => j.runId)).toEqual([a1.runId, b1.runId, a2.runId]);
  });

  it('runs higher priority first, FIFO within a priority', async () => {
    const { q, started, finish } = harness(1);
    const first = job('x', 50);
    q.enqueue(first); // starts immediately
    const low1 = job('a', 50);
    const low2 = job('b', 50);
    const high = job('c', 100);
    [low1, low2, high].forEach((j) => q.enqueue(j));
    await finish(first);
    await finish(started[1]!);
    await finish(started[2]!);
    expect(started.map((j) => j.runId)).toEqual([first.runId, high.runId, low1.runId, low2.runId]);
  });

  it('detects duplicates by key while waiting or running', () => {
    const { q } = harness(1);
    q.enqueue(job('a', 50, 'task-1'));
    q.enqueue(job('b', 50, 'task-2'));
    expect(q.has('task-1')).toBe(true);
    expect(q.has('task-2')).toBe(true);
    expect(q.has('task-3')).toBe(false);
  });

  it('cancels waiting jobs (removed) and running jobs (aborted)', async () => {
    const { q, started } = harness(1);
    const running = job('a');
    const waiting = job('b');
    q.enqueue(running);
    q.enqueue(waiting);
    expect(q.cancel(waiting.runId)).toBe('pending');
    expect(waiting.abort.signal.aborted).toBe(true);
    expect(q.cancel(running.runId)).toBe('running');
    expect(running.abort.signal.aborted).toBe(true);
    await q.idle();
    expect(started).toHaveLength(1);
    expect(q.cancel('nope')).toBe(false);
  });

  it('reservations hold an idle account and refuse a busy one', async () => {
    const { q, started, finish } = harness(2);
    const release = q.reserve('a')!;
    expect(release).toBeTypeOf('function');
    const a = job('a');
    q.enqueue(a);
    expect(started).toHaveLength(0);
    expect(q.reserve('a')).toBeNull();
    release();
    expect(started).toHaveLength(1);
    await finish(a);
  });
});
