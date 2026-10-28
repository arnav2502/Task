import type { ExecutionContext, PlatformAdapter, TaskResult } from '../../automation-server/src/adapters/base/platformAdapter';
import { TaskExecutor, type AttemptState } from '../../automation-server/src/tasks/taskExecutor';
import type { Job } from '../../automation-server/src/queue/jobQueue';

export type Behaviour = (ctx: { job: Job; ctx: ExecutionContext; attempt: number }) => Promise<TaskResult>;

/**
 * Test double for queue / retry / timeout / scheduler tests: keeps every bit of TaskExecutor
 * bookkeeping (runs, retries, timeouts, cancellation, notifications, account status) but replaces
 * the browser work with `behaviour`.
 */
export class FakeExecutor extends TaskExecutor {
  behaviour: Behaviour = async () => ({ message: 'ok' });
  readonly attempts = new Map<string, number>();
  active = 0;
  maxActive = 0;
  readonly timeline: Array<{ runId: string; accountId: string; start: number; end: number }> = [];

  protected override async performAttempt(job: Job, _adapter: PlatformAdapter, ctx: ExecutionContext, _state: AttemptState): Promise<TaskResult> {
    void _adapter;
    void _state;
    const attempt = (this.attempts.get(job.runId) ?? 0) + 1;
    this.attempts.set(job.runId, attempt);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    const start = Date.now();
    try {
      ctx.stage('LOGIN_CHECK');
      ctx.stage('TASK_EXECUTION');
      return await this.behaviour({ job, ctx, attempt });
    } finally {
      this.active--;
      this.timeline.push({ runId: job.runId, accountId: job.accountId, start, end: Date.now() });
    }
  }
}

export const fakeServices = () => ({ executor: (deps: ConstructorParameters<typeof TaskExecutor>[0]) => new FakeExecutor(deps) });
