import type { ReactNode } from 'react';
import type { PlatformActivity } from '@shared/types/index';
import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { navigate } from '../app/router';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { PlatformMark, RunStatusPill } from '../components/status';
import { QueuePanel } from '../components/QueuePanel';
import { cx, formatTime, greeting, relativeTime, taskLabel } from '../utils/format';

function StatCard({ label, value, icon, tone, hint, onClick }: { label: string; value: ReactNode; icon: IconName; tone: string; hint?: ReactNode; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'group relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-800/80 p-4 text-left shadow-card transition',
        onClick && 'hover:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
      )}
    >
      <div className={cx('pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl', tone)} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg bg-opacity-15 text-white', tone)}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Comp>
  );
}

function PlatformActivityCard({ p }: { p: PlatformActivity }) {
  const active = p.status === 'active';
  return (
    <Card className={cx('flex flex-col p-4', !active && 'opacity-70')}>
      <div className="flex items-center gap-3">
        <PlatformMark platform={p} muted={!active} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{p.name}</div>
          <div className="text-xs text-slate-500">{active ? `${p.connectedAccounts}/${p.accounts} accounts connected · ${p.enabledTasks}/${p.tasks} tasks on` : 'Not available yet'}</div>
        </div>
        {active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="slate">Coming soon</Badge>}
      </div>
      {active ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(p.metrics.length ? p.metrics : [{ key: 'runs', label: 'Runs today', value: p.runsToday }]).slice(0, 9).map((m) => (
              <div key={m.key} className="rounded-lg bg-white/[0.03] px-3 py-2" title={m.hint}>
                <div className="truncate text-[11px] text-slate-500">{m.label}</div>
                <div className="text-lg font-semibold text-slate-100">{m.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" style={{ width: `${p.successRate ?? 0}%` }} />
            </div>
            <span className="text-xs text-slate-400">{p.successRate === null ? 'No runs in 7 days' : `${p.successRate}% success · 7 days`}</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Last run {relativeTime(p.lastRunAt)}</span>
            <span>Next {p.nextRunAt ? relativeTime(p.nextRunAt) : '—'}</span>
          </div>
          <Button size="sm" variant="ghost" className="mt-3 self-start" icon="arrowRight" onClick={() => navigate({ name: 'platform', id: p.platformId })}>
            Open {p.name}
          </Button>
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">Coming soon — this platform's automations are not available yet.</div>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { platformById, settings } = useApp();
  const { data, error, loading, reload } = useResource(() => api.dashboard(), [], ['run:update', 'account:update', 'account:deleted', 'tasks:changed', 'schedules:changed', 'notification']);
  const name = data?.displayName || settings?.displayName;

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-400">Here&apos;s what&apos;s happening with your automations.</p>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={() => void reload()} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {loading && !data
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
          : data && (
              <>
                <StatCard label="Total Tasks" value={data.stats.totalTasks} icon="tasks" tone="bg-indigo-500" hint={`${data.stats.enabledTasks} scheduled-on`} onClick={() => navigate({ name: 'tasks' })} />
                <StatCard label="Running" value={data.stats.runningNow} icon="activity" tone="bg-violet-500" hint={`${data.stats.queued} waiting in queue`} />
                <StatCard label="Successful Today" value={data.stats.successfulToday} icon="checkCircle" tone="bg-emerald-500" hint="across all platforms" onClick={() => navigate({ name: 'history' })} />
                <StatCard label="Failed Today" value={data.stats.failedToday} icon="xCircle" tone="bg-rose-500" hint={data.stats.failedToday ? "open history to review" : "all clear"} onClick={() => navigate({ name: 'history' })} />
                <StatCard label="Upcoming" value={data.stats.upcoming} icon="calendarClock" tone="bg-sky-500" hint="next 24 hours" onClick={() => navigate({ name: 'schedules' })} />
                <StatCard
                  label="Connected Accounts"
                  value={`${data.stats.connectedAccounts}/${data.stats.totalAccounts}`}
                  icon="accounts"
                  tone="bg-amber-500"
                  hint="signed-in sessions"
                  onClick={() => navigate({ name: 'accounts' })}
                />
              </>
            )}
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Platform Activity</h2>
          <a href="#/platforms" className="text-xs text-indigo-300 hover:underline">
            All platforms
          </a>
        </div>
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {loading && !data ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-56" />) : data?.platforms.map((p) => <PlatformActivityCard key={p.platformId} p={p} />)}
        </div>
      </section>

      <div className="mt-8 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon="activity" title="Recent Activity" subtitle="Latest runs across every platform" action={<a href="#/history" className="text-xs text-indigo-300 hover:underline">View history</a>} />
          {data && data.recentRuns.length === 0 ? (
            <EmptyState icon="history" title="No runs yet" description="Run a task or create a schedule — results show up here live." />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {(data?.recentRuns ?? []).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => navigate({ name: 'history', runId: r.id })} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-white/[0.02] focus:outline-none focus-visible:bg-white/[0.04]">
                    <PlatformMark platform={platformById(r.platformId)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-100">
                        {taskLabel(r.taskType, r.taskName)} <span className="text-slate-500">· {r.accountName}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">{r.status === 'running' ? r.currentStep ?? 'Running…' : r.error ?? r.resultMessage ?? r.id}</div>
                    </div>
                    <div className="hidden text-right text-xs text-slate-500 sm:block">{relativeTime(r.completedAt ?? r.startedAt ?? r.queuedAt)}</div>
                    <RunStatusPill status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader icon="calendarClock" title="Upcoming Automations" action={<a href="#/schedules" className="text-xs text-indigo-300 hover:underline">Schedules</a>} />
            {data && data.upcoming.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-slate-500">Nothing scheduled.</div>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {(data?.upcoming ?? []).map((u) => (
                  <li key={`${u.scheduleId}-${u.at}`} className="flex items-center gap-3 px-5 py-2.5">
                    <PlatformMark platform={platformById(u.platformId)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-100">{u.taskName}</div>
                      <div className="truncate text-xs text-slate-500">
                        {u.accountName} · {u.summary}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium text-slate-200">{formatTime(u.at)}</div>
                      <div className="text-[11px] text-slate-500">{relativeTime(u.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <QueuePanel initial={data?.queue ?? null} compact />
        </div>
      </div>
    </div>
  );
}
