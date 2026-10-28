/** LinkedIn lead tasks: generic task instances joined with their LinkedIn numbers. */
import { useMemo, useState } from 'react';
import type { Task } from '@shared/types/index';
import type { LeadFinderConfig, LinkedInTaskStats } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Button, Card, EmptyState, ErrorBanner, SkeletonList, Toggle } from '../../../components/ui';
import { RunStatusPill, TaskStateBadge } from '../../../components/status';
import { ScheduleFormModal } from '../../../components/forms/ScheduleForm';
import { navigate } from '../../../app/router';
import { relativeTime } from '../../../utils/format';
import { ACTION_LABEL, LEAD_FINDER, PLATFORM, searchSummary, tabHref } from './common';

const LIVE = ['tasks:changed', 'run:update', 'schedules:changed', 'account:update', 'account:deleted'] as const;

export function useLinkedInTasks() {
  return useResource(
    async () => {
      const [tasks, stats] = await Promise.all([api.tasks({ platformId: PLATFORM }), api.linkedin.taskStats().catch(() => [] as LinkedInTaskStats[])]);
      const byId = new Map(stats.map((x) => [x.taskId, x]));
      return tasks.filter((t) => t.taskType === LEAD_FINDER).map((task) => ({ task, stats: byId.get(task.id) ?? null }));
    },
    [],
    [...LIVE],
  );
}

function LeadTaskCard({ task, stats, onChanged }: { task: Task; stats: LinkedInTaskStats | null; onChanged: () => void }) {
  const { toast, fail, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const cfg = task.configuration as Partial<LeadFinderConfig>;
  const active = task.status === 'queued' || task.status === 'running';
  const pending = stats?.pendingReview ?? task.pendingReview;

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.runTask(task.id);
      toast('success', `${task.name} queued (${r.id}) — it only finds and prepares; nothing is sent`);
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete “${task.name}”?`, message: 'The task and its schedules are removed. Leads it found stay in your lead list.', confirmLabel: 'Delete task', danger: true }))) return;
    try {
      await api.deleteTask(task.id);
      toast('success', `${task.name} deleted`);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.06] bg-ink-850/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-white">{task.name}</h4>
            <TaskStateBadge state={task.state} />
          </div>
          <p className="mt-1 truncate text-xs text-slate-400" title={searchSummary(cfg)}>
            {searchSummary(cfg) || 'No search criteria'}
          </p>
          {cfg.action && <p className="text-[11px] text-slate-500">{ACTION_LABEL[cfg.action]}</p>}
        </div>
        <Toggle
          size="sm"
          checked={task.enabled}
          label={`Scheduled runs for ${task.name}`}
          onChange={async (v) => {
            try {
              await api.updateTask(task.id, { enabled: v });
              onChanged();
            } catch (err) {
              fail(err);
            }
          }}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Leads found', value: stats?.leadsFound ?? '—' },
          { label: 'Pending review', value: pending },
          { label: 'Requests sent', value: stats?.connectionsSent ?? '—' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg bg-white/[0.03] px-2 py-2">
            <div className="text-lg font-semibold text-slate-100">{m.value}</div>
            <div className="text-[11px] text-slate-500">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Last run</div>
          <div className="mt-0.5 flex items-center gap-2 text-slate-200">
            {relativeTime(task.lastRunAt)}
            {task.lastRunId && !active && (
              <button type="button" onClick={() => navigate({ name: 'history', runId: task.lastRunId! })} title="Open last run">
                <RunStatusPill status={task.status} />
              </button>
            )}
            {active && <RunStatusPill status={task.status} />}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Next run</div>
          <div className="mt-0.5 text-slate-200">{task.enabled ? (task.nextRunAt ? relativeTime(task.nextRunAt) : 'Not scheduled') : 'Paused'}</div>
        </div>
      </div>
      {stats?.lastSearch && (
        <p className="mt-2 text-xs text-slate-500">
          Last search: {stats.lastSearch.resultsRead} read · {stats.lastSearch.matched} matched · {stats.lastSearch.newLeads} new · {stats.lastSearch.candidates} prepared
        </p>
      )}
      {task.lastError && task.lastStatus === 'failed' && (
        <p className="mt-2 line-clamp-2 text-xs text-rose-300/80" title={task.lastError}>
          {task.lastError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
        <Button size="sm" variant="primary" icon="play" loading={busy} disabled={active} onClick={() => void run()}>
          {active ? (task.status === 'running' ? 'Running…' : 'Queued') : 'Run now'}
        </Button>
        {pending > 0 && (
          <Button size="sm" variant="secondary" icon="hand" onClick={() => (location.hash = tabHref('drafts', { task: task.id }))}>
            Review ({pending})
          </Button>
        )}
        <Button size="sm" icon="calendarClock" onClick={() => setScheduling(true)}>
          Schedule{task.scheduleCount ? ` (${task.scheduleCount})` : ''}
        </Button>
        <Button size="sm" variant="ghost" icon="edit" onClick={() => (location.hash = tabHref('finder', { edit: task.id }))}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" icon="trash" className="ml-auto text-rose-300 hover:text-rose-200" disabled={active} onClick={() => void remove()}>
          Delete
        </Button>
      </div>
      {scheduling && <ScheduleFormModal defaultTaskId={task.id} platformId={PLATFORM} onClose={() => setScheduling(false)} />}
    </div>
  );
}

export function TasksTab() {
  const { data, error, loading, reload } = useLinkedInTasks();
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => b.task.pendingReview - a.task.pendingReview || a.task.name.localeCompare(b.task.name)), [data]);
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <SkeletonList rows={3} />;
  if (!sorted.length)
    return (
      <Card>
        <EmptyState
          icon="search"
          title="No lead tasks yet"
          description="Create a lead search — e.g. “Technical Recruiter · India · 2nd degree” — and run it now or on a schedule."
          action={
            <Button variant="primary" icon="plus" onClick={() => (location.hash = tabHref('finder'))}>
              Open Lead Finder
            </Button>
          }
        />
      </Card>
    );
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon="plus" onClick={() => (location.hash = tabHref('finder'))}>
          New lead task
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {sorted.map(({ task, stats }) => (
          <LeadTaskCard key={task.id} task={task} stats={stats} onChanged={() => void reload()} />
        ))}
      </div>
    </div>
  );
}
