import type { BrowserMode, RunTrigger } from '@shared/types/index.js';

export interface Job {
  runId: string;
  platformId: string;
  accountId: string;
  /** Duplicate-prevention key: a task id, or "<accountId>:<SYSTEM_TYPE>". */
  dedupeKey: string;
  taskType: string;
  trigger: RunTrigger;
  mode: BrowserMode;
  priority: number;
  enqueuedAt: number;
  abort: AbortController;
}

/**
 * One platform-independent queue for every automation.
 *
 * - Priority: higher first, FIFO within a priority (manual runs overtake scheduled ones).
 * - One job per account: a persistent browser profile can only be opened by one browser, so jobs of
 *   the same account never overlap (whatever their platform); other accounts run in parallel.
 * - Concurrency: at most `maxConcurrent()` jobs run at once.
 * - Duplicate prevention: `has(dedupeKey)` tells callers a task is already waiting or running.
 * - Reservations: direct operations (e.g. selector validation) can hold an idle account so no job
 *   opens its browser meanwhile.
 */
export class JobQueue {
  private readonly pending: Job[] = [];
  private readonly running = new Map<string, Job>();
  private readonly reserved = new Set<string>();
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly execute: (job: Job) => Promise<void>,
    private readonly maxConcurrent: () => number,
    private readonly onChange: () => void = () => {},
    /** Called after a job has left the queue (its account is free again). */
    private readonly onSettled: (job: Job) => void = () => {},
  ) {}

  enqueue(job: Job) {
    this.pending.push(job);
    this.sort();
    this.onChange();
    this.pump();
  }

  has(dedupeKey: string): boolean {
    return this.pending.some((j) => j.dedupeKey === dedupeKey) || [...this.running.values()].some((j) => j.dedupeKey === dedupeKey);
  }

  isRunning(runId: string): boolean {
    return this.running.has(runId);
  }

  isAccountBusy(accountId: string): boolean {
    return (
      this.reserved.has(accountId) ||
      this.pending.some((j) => j.accountId === accountId) ||
      [...this.running.values()].some((j) => j.accountId === accountId)
    );
  }

  /** Hold an idle account for a direct operation. Returns a release function, or null if busy. */
  reserve(accountId: string): (() => void) | null {
    if (this.isAccountBusy(accountId)) return null;
    this.reserved.add(accountId);
    return () => {
      this.reserved.delete(accountId);
      this.pump();
    };
  }

  /** Cancel a waiting job (removed) or a running one (aborted). */
  cancel(runId: string): 'pending' | 'running' | false {
    const i = this.pending.findIndex((j) => j.runId === runId);
    if (i !== -1) {
      const [job] = this.pending.splice(i, 1);
      job!.abort.abort();
      this.onChange();
      this.checkIdle();
      return 'pending';
    }
    const job = this.running.get(runId);
    if (job) {
      job.abort.abort();
      return 'running';
    }
    return false;
  }

  snapshot(): { running: Job[]; pending: Job[] } {
    return { running: [...this.running.values()], pending: [...this.pending] };
  }

  get size() {
    return { pending: this.pending.length, running: this.running.size };
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.pending.length && !this.running.size) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  pump() {
    const limit = Math.max(1, this.maxConcurrent());
    let started = false;
    while (this.running.size < limit) {
      const busy = new Set([...this.running.values()].map((j) => j.accountId));
      const idx = this.pending.findIndex((j) => !busy.has(j.accountId) && !this.reserved.has(j.accountId));
      if (idx === -1) break;
      const [job] = this.pending.splice(idx, 1);
      this.running.set(job!.runId, job!);
      started = true;
      void this.execute(job!)
        .catch(() => {
          /* the executor records its own failures */
        })
        .finally(() => {
          this.running.delete(job!.runId);
          this.onSettled(job!);
          this.onChange();
          this.pump();
          this.checkIdle();
        });
    }
    if (started) this.onChange();
  }

  private sort() {
    this.pending.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
  }

  private checkIdle() {
    if (this.pending.length || this.running.size) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }
}
