import { useMemo, useState } from 'react';
import type { Task } from '@shared/types/index';
import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { platformExtensions, reviewHref } from '../pages/platforms/registry';
import { Button, Card, EmptyState, ErrorBanner, SkeletonList, Toggle } from './ui';
import { EffectBadge, PlatformMark, RunStatusPill, TaskStateBadge } from './status';
import { TaskConfigModal } from './forms/ConfigFields';
import { ScheduleFormModal } from './forms/ScheduleForm';
import { Icon } from './icons';
import { relativeTime } from '../utils/format';

export function TaskCard({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  const { platformById } = useApp();
  const { toast, fail, confirm } = useFeedback();
  const [configuring, setConfiguring] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const platform = platformById(task.platformId);
  const descriptor = platform?.tasks.find((d) => d.type === task.taskType);
  const active = task.status === 'queued' || task.status === 'running';
  const ext = platformExtensions[task.platformId];
  const ExtraActions = ext?.taskActions;
  const review = task.pendingReview > 0 ? reviewHref(task.platformId, task.id) : null;

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${task.name}”?`,
      message: 'The task and its schedules are removed. Its run history stays in Execution History.',
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTask(task.id);
      toast('success', `${task.name} deleted`);
    } catch (err) {
      fail(err);
    }
  };

  const runNow = async () => {
    if (task.effect === 'apply' && !(await confirm({ title: `Run ${task.name} now?`, message: 'This task submits applications on your behalf, within the limits configured for it.', confirmLabel: 'Run now' })))
      return;
    setBusy(true);
    try {
      const run = await api.runTask(task.id);
      toast('success', `${task.name} queued (${run.id})`);
      onChanged({ ...task, status: 'queued' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.06] bg-ink-850/80 p-4 transition hover:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-white">{task.name}</h4>
            <EffectBadge effect={task.effect} />
            {task.multiInstance && <TaskStateBadge state={task.state} />}
          </div>
          {task.multiInstance && task.typeName !== task.name && <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{task.typeName}</div>}
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{task.description}</p>
        </div>
        <Toggle
          size="sm"
          checked={task.enabled}
          label={`Scheduled runs for ${task.name}`}
          onChange={async (v) => {
            try {
              onChanged(await api.updateTask(task.id, { enabled: v }));
            } catch (err) {
              fail(err);
            }
          }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <div className="text-slate-500">Status</div>
          <div className="mt-0.5">
            {task.lastRunId && !active ? (
              <button type="button" onClick={() => navigate({ name: 'history', runId: task.lastRunId! })} className="hover:opacity-80" title="Open last run">
                <RunStatusPill status={task.status} />
              </button>
            ) : (
              <RunStatusPill status={task.status} />
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Last execution</div>
          <div className="mt-0.5 text-slate-200">{relativeTime(task.lastRunAt)}</div>
        </div>
        <div>
          <div className="text-slate-500">Next run</div>
          <div className="mt-0.5 text-slate-200">{task.enabled ? relativeTime(task.nextRunAt) : 'Paused'}</div>
        </div>
        <div>
          <div className="text-slate-500">Success / failure</div>
          <div className="mt-0.5">
            <span className="text-emerald-300">{task.successCount}</span>
            <span className="text-slate-600"> / </span>
            <span className="text-rose-300">{task.failureCount}</span>
          </div>
        </div>
      </div>
      {task.pendingReview > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-400/25">
          <span>
            {task.pendingReview} item{task.pendingReview === 1 ? '' : 's'} waiting for your review
          </span>
          {review && (
            <a href={review} className="font-semibold text-amber-100 hover:underline">
              Review →
            </a>
          )}
        </div>
      )}
      {task.lastError && task.lastStatus !== 'success' && task.lastStatus !== 'waiting_for_review' && <p className="mt-3 line-clamp-2 text-xs text-rose-300/80" title={task.lastError}>{task.lastError}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
        <Button size="sm" variant="primary" icon="play" onClick={() => void runNow()} loading={busy} disabled={active}>
          {active ? (task.status === 'running' ? 'Running…' : 'Queued') : 'Run now'}
        </Button>
        <Button size="sm" icon="calendarClock" onClick={() => setScheduling(true)}>
          Schedule{task.scheduleCount ? ` (${task.scheduleCount})` : ''}
        </Button>
        {task.multiInstance && ext?.editTask ? (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => ext.editTask!(task)}>
            Edit
          </Button>
        ) : (
          descriptor &&
          descriptor.configFields.length > 0 && (
            <Button size="sm" variant="ghost" icon="sliders" onClick={() => setConfiguring(true)}>
              Configure{task.hasConfigOverride ? ' •' : ''}
            </Button>
          )
        )}
        {ExtraActions && <ExtraActions task={task} />}
        {task.multiInstance && (
          <Button size="sm" variant="ghost" icon="trash" className="ml-auto text-rose-300 hover:text-rose-200" onClick={() => void remove()} disabled={active}>
            Delete
          </Button>
        )}
      </div>

      {configuring && descriptor && <TaskConfigModal task={task} descriptor={descriptor} onClose={() => setConfiguring(false)} onSaved={onChanged} />}
      {scheduling && <ScheduleFormModal defaultTaskId={task.id} platformId={task.platformId} onClose={() => setScheduling(false)} />}
    </div>
  );
}

export function TasksPanel({ platformId }: { platformId?: string }) {
  const { platformById } = useApp();
  const { data, error, loading, reload, setData } = useResource(() => api.tasks(platformId ? { platformId } : {}), [platformId], ['tasks:changed', 'run:update', 'schedules:changed', 'account:update', 'account:deleted']);

  const groups = useMemo(() => {
    const byPlatform = new Map<string, Map<string, Task[]>>();
    for (const t of data ?? []) {
      const accounts = byPlatform.get(t.platformId) ?? new Map<string, Task[]>();
      accounts.set(t.accountId, [...(accounts.get(t.accountId) ?? []), t]);
      byPlatform.set(t.platformId, accounts);
    }
    return byPlatform;
  }, [data]);

  const replace = (t: Task) => setData((cur) => cur?.map((x) => (x.id === t.id ? t : x)) ?? cur);

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <SkeletonList rows={3} />;
  if (!data?.length)
    return (
      <Card>
        <EmptyState
          icon="tasks"
          title="No tasks yet"
          description="Tasks appear automatically when you add an account (LinkedIn lead searches are created in LinkedIn → Lead Finder)."
          action={
            <Button variant="primary" icon="plus" onClick={() => navigate({ name: 'accounts' })}>
              Add an account
            </Button>
          }
        />
      </Card>
    );

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([pid, accounts]) => {
        const p = platformById(pid);
        return (
          <section key={pid}>
            {!platformId && (
              <div className="mb-3 flex items-center gap-2">
                <PlatformMark platform={p} size="sm" />
                <h2 className="text-sm font-semibold text-white">{p?.name ?? pid}</h2>
              </div>
            )}
            <div className="space-y-5">
              {[...accounts.entries()].map(([accountId, tasks]) => (
                <div key={accountId}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
                    <Icon name="accounts" size={14} />
                    {tasks[0]?.accountName}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {tasks.map((t) => (
                      <TaskCard key={t.id} task={t} onChanged={replace} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
