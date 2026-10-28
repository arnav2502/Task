import { RUN_STAGES } from '@shared/constants/index.js';
import type {
  AccountSummary,
  DashboardData,
  PlatformActivity,
  PlatformMetric,
  RunDetails,
  TimelineEntry,
  UpcomingRun,
} from '@shared/types/index.js';
import type { AdapterRegistry } from '../adapters/base/registry.js';
import type { PlatformAdapter } from '../adapters/base/platformAdapter.js';
import { toPublicAccount } from '../accounts/accountService.js';
import type { AppDatabase } from '../database/database.js';
import type { RunRecord } from '../database/repositories/runs.js';
import { notFound } from '../errors/automationError.js';
import { describeSchedule } from '../scheduler/scheduleMath.js';
import { toPublicRun, type TaskExecutor } from '../tasks/taskExecutor.js';
import type { TaskService } from '../tasks/taskService.js';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Read models for the dashboard, platform pages, accounts and run details. */
export class DashboardService {
  constructor(
    private readonly db: AppDatabase,
    private readonly registry: AdapterRegistry,
    private readonly tasks: TaskService,
    private readonly executor: TaskExecutor,
  ) {}

  accountSummaries(platformId?: string): AccountSummary[] {
    const active = this.db.runs.active();
    const tasks = this.db.tasks.list({ platformId });
    const schedules = this.db.schedules.list({ platformId });
    return this.db.accounts.list(platformId).map((a) => {
      const own = tasks.filter((t) => t.accountId === a.id);
      const enabledTaskIds = new Set(own.filter((t) => t.enabled).map((t) => t.id));
      const next = a.enabled
        ? (schedules
            .filter((s) => s.accountId === a.id && s.enabled && s.nextRunAt && enabledTaskIds.has(s.taskId))
            .map((s) => s.nextRunAt!)
            .sort()[0] ?? null)
        : null;
      const run = active.find((r) => r.accountId === a.id && r.status === 'running') ?? active.find((r) => r.accountId === a.id);
      return {
        ...toPublicAccount(a),
        activeRun: run ? toPublicRun(run) : null,
        nextRunAt: next,
        taskCount: own.length,
        enabledTaskCount: enabledTaskIds.size,
      };
    });
  }

  accountSummary(id: string): AccountSummary {
    const a = this.db.accounts.get(id);
    if (!a) throw notFound('Account');
    return this.accountSummaries(a.platformId).find((x) => x.id === id)!;
  }

  platformActivity(adapter: PlatformAdapter): PlatformActivity {
    const id = adapter.platformId;
    const today = startOfToday();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const accounts = this.db.accounts.list(id);
    const tasks = this.db.tasks.list({ platformId: id });
    const counts = this.db.runs.countsSince(today.toISOString(), id);
    const week = this.db.runs.countsSince(weekAgo, id);
    const weekSuccess = week.success + week.waiting_for_review;
    const finishedWeek = weekSuccess + week.failed + week.action_required;
    const nextRunAt =
      this.db.schedules
        .list({ platformId: id })
        .filter((s) => s.enabled && s.nextRunAt && accounts.find((a) => a.id === s.accountId)?.enabled && tasks.find((t) => t.id === s.taskId)?.enabled)
        .map((s) => s.nextRunAt!)
        .sort()[0] ?? null;
    const metrics: PlatformMetric[] = [];
    if (adapter.available) {
      const success = this.db.runs.successByTaskType(id, today.toISOString());
      for (const t of adapter.getTasks()) {
        if (t.metricLabel) metrics.push({ key: t.type, label: t.metricLabel, value: success[t.type] ?? 0, hint: 'today' });
      }
      metrics.push(...(adapter.getMetrics?.(today) ?? []));
    }
    return {
      platformId: id,
      name: adapter.platformName,
      status: adapter.descriptor.status,
      accent: adapter.descriptor.accent,
      monogram: adapter.descriptor.monogram,
      accounts: accounts.length,
      connectedAccounts: accounts.filter((a) => a.status === 'connected').length,
      tasks: tasks.length,
      enabledTasks: tasks.filter((t) => t.enabled).length,
      runsToday: counts.total - counts.skipped,
      successToday: counts.success + counts.waiting_for_review,
      failedToday: counts.failed + counts.action_required,
      successRate: finishedWeek ? Math.round((weekSuccess / finishedWeek) * 100) : null,
      lastRunAt: this.db.runs.lastRunAt(id),
      nextRunAt,
      metrics,
    };
  }

  upcoming(limit = 8): UpcomingRun[] {
    const accounts = new Map(this.db.accounts.list().map((a) => [a.id, a]));
    const tasks = new Map(this.db.tasks.list().map((t) => [t.id, t]));
    return this.db.schedules
      .list()
      .filter((s) => s.enabled && s.nextRunAt && accounts.get(s.accountId)?.enabled && tasks.get(s.taskId)?.enabled)
      .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))
      .slice(0, limit)
      .map((s) => ({
        scheduleId: s.id,
        taskId: s.taskId,
        platformId: s.platformId,
        accountName: accounts.get(s.accountId)?.name ?? '?',
        taskName: this.registry.get(s.platformId)?.getTask(s.taskType)?.name ?? s.taskType,
        at: s.nextRunAt!,
        summary: describeSchedule(s),
      }));
  }

  dashboard(): DashboardData {
    const settings = this.db.settings.get();
    const today = startOfToday().toISOString();
    const counts = this.db.runs.countsSince(today);
    const tasks = this.db.tasks.list();
    const accounts = this.db.accounts.list();
    const queue = this.executor.snapshot();
    const in24h = Date.now() + 86_400_000;
    const upcoming = this.upcoming(50);
    return {
      displayName: settings.displayName,
      stats: {
        totalTasks: tasks.length,
        enabledTasks: tasks.filter((t) => t.enabled).length,
        runningNow: queue.running.length,
        queued: queue.pending.length,
        successfulToday: counts.success + counts.waiting_for_review,
        failedToday: counts.failed + counts.action_required,
        upcoming: upcoming.filter((u) => Date.parse(u.at) <= in24h).length,
        connectedAccounts: accounts.filter((a) => a.status === 'connected').length,
        totalAccounts: accounts.length,
      },
      platforms: this.registry.list().map((a) => this.platformActivity(a)),
      recentRuns: this.db.runs.list({ limit: 10 }).runs.map(toPublicRun),
      upcoming: upcoming.slice(0, 8),
      queue,
      unreadNotifications: this.db.notifications.unreadCount(),
    };
  }

  runDetails(id: string): RunDetails {
    const run = this.db.runs.get(id);
    if (!run) throw notFound('Run');
    const logs = this.db.runs.logs(id);
    return { ...toPublicRun(run), logs, timeline: buildTimeline(run, logs) };
  }
}

/** Derive the stage timeline from the first log line of each stage and the run's outcome. */
export function buildTimeline(run: RunRecord, logs: RunDetails['logs']): TimelineEntry[] {
  const firstTs = new Map<string, string>();
  for (const l of logs) if (l.stage && !firstTs.has(l.stage)) firstTs.set(l.stage, l.ts);
  if (run.startedAt && !firstTs.has('STARTED')) firstTs.set('STARTED', run.startedAt);
  const reached = RUN_STAGES.filter((s) => firstTs.has(s));
  const lastWork = [...reached].reverse().find((s) => s !== 'COMPLETED') ?? null;
  const finished = !['queued', 'running'].includes(run.status);
  const failed = finished && run.status !== 'success';
  return RUN_STAGES.map((stage, i) => {
    const startedAt = firstTs.get(stage) ?? null;
    const nextStarted = RUN_STAGES.slice(i + 1)
      .map((s) => firstTs.get(s))
      .find(Boolean);
    let state: TimelineEntry['state'];
    if (!startedAt) state = finished ? 'skipped' : 'pending';
    else if (stage === 'COMPLETED') state = failed ? 'failed' : 'done';
    else if (!finished && stage === run.stage) state = 'active';
    else if (failed && stage === lastWork) state = 'failed';
    else state = 'done';
    if (stage === 'COMPLETED' && !startedAt && finished) state = failed ? 'failed' : 'done';
    return {
      stage,
      state,
      startedAt: startedAt ?? (stage === 'COMPLETED' && finished ? run.completedAt : null),
      endedAt: stage === 'COMPLETED' ? run.completedAt : (nextStarted ?? (finished ? run.completedAt : null)),
    };
  });
}
