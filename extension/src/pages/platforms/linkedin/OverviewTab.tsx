/** LinkedIn overview: lead numbers, today's tasks, pending reviews, account readiness. */
import { useState } from 'react';
import type { LinkedInStats } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Button, Callout, Card, CardHeader, EmptyState, ErrorBanner, Skeleton } from '../../../components/ui';
import { AccountStatusPill, RunStatusPill } from '../../../components/status';
import { AccountFormModal } from '../../../components/forms/AccountForm';
import { navigate } from '../../../app/router';
import { formatTime, relativeTime } from '../../../utils/format';
import { LEAD_FINDER, PLATFORM, tabHref } from './common';
import { useLinkedInTasks } from './TasksTab';

const TILES: Array<{ key: keyof LinkedInStats; label: string; tab?: string; query?: Record<string, string> }> = [
  { key: 'leadsFound', label: 'Leads found', tab: 'leads' },
  { key: 'leadsToday', label: 'Leads today', tab: 'leads' },
  { key: 'reviewed', label: 'Reviewed', tab: 'leads', query: { status: 'REVIEWED' } },
  { key: 'selected', label: 'Selected', tab: 'leads', query: { status: 'SELECTED' } },
  { key: 'pendingReview', label: 'Pending review', tab: 'drafts' },
  { key: 'connectionsSent', label: 'Connections sent', tab: 'leads', query: { status: 'CONNECTION_SENT' } },
  { key: 'connected', label: 'Connected', tab: 'leads', query: { status: 'CONNECTED' } },
  { key: 'skipped', label: 'Skipped', tab: 'leads', query: { status: 'SKIPPED' } },
];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function OverviewTab() {
  const { toast, fail } = useFeedback();
  const [adding, setAdding] = useState(false);
  const stats = useResource(() => api.linkedin.stats(), [], ['run:update', 'tasks:changed']);
  const accounts = useResource(() => api.accounts(PLATFORM), [], ['account:update', 'account:deleted']);
  const tasks = useLinkedInTasks();
  const today = useResource(
    async () => {
      const from = startOfToday();
      const to = new Date(from.getTime() + 86_400_000);
      const [runs, schedules] = await Promise.all([
        api.runs({ platformId: PLATFORM, taskType: LEAD_FINDER, from: from.toISOString(), limit: 20 }),
        api.schedules({ platformId: PLATFORM }),
      ]);
      const upcoming = schedules.filter((s) => s.enabled && s.nextRunAt && Date.parse(s.nextRunAt) < to.getTime());
      return { runs: runs.runs, upcoming };
    },
    [],
    ['run:update', 'schedules:changed'],
  );

  const s = stats.data;
  const taskName = (id: string | null) => tasks.data?.find((t) => t.task.id === id)?.task.name ?? 'Lead task';

  return (
    <div className="space-y-5">
      {accounts.data && accounts.data.length === 0 && (
        <Callout tone="amber" icon="accounts" title="Add your LinkedIn account">
          <p>TaskPilot searches in your own signed-in LinkedIn browser. Add the account, then click Connect and sign in once — your password is never stored.</p>
          <Button className="mt-2" size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add LinkedIn account
          </Button>
        </Callout>
      )}
      {accounts.data?.map(
        (a) =>
          a.status !== 'connected' && (
            <Callout key={a.id} tone="amber" icon="login" title={`${a.name} is not signed in`}>
              <div className="flex flex-wrap items-center gap-3">
                <AccountStatusPill status={a.status} />
                <span className="text-xs">{a.statusMessage ?? 'Click Connect to sign in to LinkedIn in a visible browser window.'}</span>
                <Button
                  size="sm"
                  variant="primary"
                  icon="login"
                  onClick={async () => {
                    try {
                      const run = await api.connect(a.id);
                      toast('success', `A browser window is opening — sign in to LinkedIn there (${run.id})`);
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  Connect
                </Button>
              </div>
            </Callout>
          ),
      )}

      {stats.error && <ErrorBanner message={stats.error} onRetry={() => void stats.reload()} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => t.tab && (location.hash = tabHref(t.tab, t.query))}
            className="rounded-xl border border-white/[0.06] bg-ink-800/80 p-4 text-left shadow-card transition hover:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <div className="text-xs font-medium text-slate-400">{t.label}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{s ? s[t.key] : <Skeleton className="h-7 w-12" />}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Today's LinkedIn tasks"
            subtitle="Runs today and what is scheduled next"
            icon="calendarClock"
            action={
              <Button size="sm" variant="ghost" icon="plus" onClick={() => (location.hash = tabHref('finder'))}>
                New lead task
              </Button>
            }
          />
          {today.error && <div className="p-4"><ErrorBanner message={today.error} /></div>}
          {today.data && today.data.runs.length === 0 && today.data.upcoming.length === 0 ? (
            <EmptyState icon="calendarClock" title="Nothing today" description="Run a lead task or schedule one — e.g. every weekday at 10:00." />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {(today.data?.runs ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-16 shrink-0 text-sm font-medium text-slate-300">{formatTime(r.startedAt ?? r.queuedAt)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{r.taskName}</div>
                    <div className="truncate text-xs text-slate-500">{r.resultMessage ?? r.error ?? r.currentStep ?? '—'}</div>
                  </div>
                  <RunStatusPill status={r.status} />
                  {r.status === 'waiting_for_review' ? (
                    <Button size="sm" variant="primary" icon="hand" onClick={() => (location.hash = tabHref('drafts', r.taskId ? { task: r.taskId } : undefined))}>
                      Review{r.reviewCount ? ` (${r.reviewCount})` : ''}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => navigate({ name: 'history', runId: r.id })}>
                      Details
                    </Button>
                  )}
                </li>
              ))}
              {(today.data?.upcoming ?? []).map((u) => (
                <li key={u.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-16 shrink-0 text-sm font-medium text-slate-300">{formatTime(u.nextRunAt)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{taskName(u.taskId)}</div>
                    <div className="truncate text-xs text-slate-500">{u.summary}</div>
                  </div>
                  <span className="text-xs text-sky-300">Scheduled · {relativeTime(u.nextRunAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Connection drafts" subtitle="Waiting for your review" icon="hand" />
            <div className="p-5">
              <div className="text-3xl font-semibold text-white">{s?.pendingReview ?? '—'}</div>
              <p className="mt-1 text-xs text-slate-400">Edit the note, skip, or confirm each request yourself.</p>
              <Button className="mt-3" size="sm" variant="primary" icon="arrowRight" disabled={!s?.pendingReview} onClick={() => (location.hash = tabHref('drafts'))}>
                Review now
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Lead tasks" icon="tasks" />
            <div className="grid grid-cols-2 gap-3 p-5 text-sm">
              {[
                { label: 'Scheduled', value: tasks.data?.filter((t) => t.task.state === 'SCHEDULED').length },
                { label: 'Waiting for review', value: tasks.data?.filter((t) => t.task.state === 'WAITING_FOR_REVIEW').length },
                { label: 'Completed', value: tasks.data?.filter((t) => t.task.state === 'COMPLETED').length },
                { label: 'Drafts', value: tasks.data?.filter((t) => t.task.state === 'DRAFT').length },
              ].map((m) => (
                <div key={m.label}>
                  <div className="text-xl font-semibold text-white">{m.value ?? '—'}</div>
                  <div className="text-xs text-slate-500">{m.label}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Callout tone="indigo" icon="shield" title="You stay in control">
        TaskPilot only searches and prepares. Every connection request is sent only when you confirm it, one lead at a time. LinkedIn restricts automated activity, so
        TaskPilot keeps runs small (a few results per run), uses your own signed-in browser, and never bypasses checks or limits.
      </Callout>

      {adding && <AccountFormModal defaultPlatformId={PLATFORM} onClose={() => setAdding(false)} onSaved={() => void accounts.reload()} />}
    </div>
  );
}
