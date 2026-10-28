import { useMemo, useState } from 'react';
import type { RunFilters, RunStatus, RunTrigger } from '@shared/types/index';
import { RUN_STATUSES, RUN_TRIGGERS, SYSTEM_TASK_LABELS } from '@shared/constants/index';
import { api } from '../services/api';
import { useApp, useLive, useResource } from '../app/state';
import { navigate } from '../app/router';
import { Badge, Button, Card, EmptyState, ErrorBanner, IconButton, Input, PageHeader, Select, SkeletonList } from '../components/ui';
import { PlatformTag, RunStatusPill } from '../components/status';
import { RunDetailsDrawer } from '../components/RunDetails';
import { QueuePanel } from '../components/QueuePanel';
import { formatDateTime, formatDuration, taskLabel, TRIGGER_LABEL } from '../utils/format';

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  waiting_for_review: 'Waiting for review',
  failed: 'Failed',
  action_required: 'Action required',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

/** <input type="date"> value → ISO bound in local time. */
function dayBound(date: string, end: boolean): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  const dt = end ? new Date(y!, m! - 1, d!, 23, 59, 59, 999) : new Date(y!, m! - 1, d!, 0, 0, 0, 0);
  return dt.toISOString();
}

/**
 * Execution history. `fixedPlatformId` embeds it in a platform page (e.g. LinkedIn → History):
 * no page header / queue, the platform filter is locked, and run details open in place.
 */
export function HistoryPage({ runId, fixedPlatformId }: { runId?: string; fixedPlatformId?: string }) {
  const { platforms, platformById } = useApp();
  const embedded = !!fixedPlatformId;
  const [localRunId, setLocalRunId] = useState<string | null>(null);
  const openRun = (id: string) => (embedded ? setLocalRunId(id) : navigate({ name: 'history', runId: id }));
  const [platformIdState, setPlatformId] = useState('');
  const platformId = fixedPlatformId ?? platformIdState;
  const [accountId, setAccountId] = useState('');
  const [taskType, setTaskType] = useState('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [trigger, setTrigger] = useState<RunTrigger | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const accounts = useResource(() => api.accounts(), [], ['account:update', 'account:deleted']);

  const filters: RunFilters = {
    platformId: platformId || undefined,
    accountId: accountId || undefined,
    taskType: taskType || undefined,
    status: status || undefined,
    trigger: trigger || undefined,
    from: dayBound(from, false),
    to: dayBound(to, true),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const key = JSON.stringify(filters);
  const runs = useResource(() => api.runs(filters), [key]);

  // Live: patch rows in place; new runs trigger a debounced reload on the first page.
  useLive((m) => {
    if (m.type !== 'run:update') return;
    const exists = runs.data?.runs.some((r) => r.id === m.run.id);
    if (exists) runs.setData((cur) => (cur ? { ...cur, runs: cur.runs.map((r) => (r.id === m.run.id ? m.run : r)) } : cur));
    else if (page === 0) void runs.reload();
  });

  const taskTypes = useMemo(() => {
    const list = platforms.filter((p) => !platformId || p.id === platformId).flatMap((p) => p.tasks.map((t) => ({ value: t.type, label: platformId ? t.name : `${p.name} · ${t.name}` })));
    const seen = new Set<string>();
    return [...list, ...Object.entries(SYSTEM_TASK_LABELS).map(([value, label]) => ({ value, label }))].filter((t) => (seen.has(t.value) ? false : (seen.add(t.value), true)));
  }, [platforms, platformId]);

  const accountOptions = (accounts.data ?? []).filter((a) => !platformId || a.platformId === platformId);
  const reset = () => {
    setPlatformId('');
    setAccountId('');
    setTaskType('');
    setStatus('');
    setTrigger('');
    setFrom('');
    setTo('');
    setPage(0);
  };
  const filtered = !!((!embedded && platformId) || accountId || taskType || status || trigger || from || to);
  const set = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(0);
  };

  const total = runs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {!embedded && (
        <>
          <PageHeader eyebrow="Monitoring" title="Execution History" subtitle="Every run of every platform, with live logs, timeline and screenshots." />
          <div className="mb-5">
            <QueuePanel compact />
          </div>
        </>
      )}

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {!embedded && (
            <Select aria-label="Platform" value={platformId} onChange={(e) => (set(setPlatformId)(e.target.value), setAccountId(''), setTaskType(''))}>
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          <Select aria-label="Account" value={accountId} onChange={(e) => set(setAccountId)(e.target.value)}>
            <option value="">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Task" value={taskType} onChange={(e) => set(setTaskType)(e.target.value)}>
            <option value="">All tasks</option>
            {taskTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => set(setStatus)(e.target.value as RunStatus | '')}>
            <option value="">All statuses</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Trigger" value={trigger} onChange={(e) => set(setTrigger)(e.target.value as RunTrigger | '')}>
            <option value="">Manual & scheduled</option>
            {RUN_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="From date" value={from} onChange={(e) => set(setFrom)(e.target.value)} />
          <Input type="date" aria-label="To date" value={to} onChange={(e) => set(setTo)(e.target.value)} />
          <Button variant="ghost" icon="x" onClick={reset} disabled={!filtered}>
            Clear filters
          </Button>
        </div>
      </Card>

      {runs.error && <ErrorBanner message={runs.error} onRetry={() => void runs.reload()} />}
      {runs.loading && !runs.data && <SkeletonList rows={6} />}
      {runs.data && runs.data.runs.length === 0 && (
        <Card>
          <EmptyState icon="history" title={filtered ? 'No runs match these filters' : 'No runs yet'} description={filtered ? 'Try clearing a filter.' : 'Run a task or create a schedule — every execution is recorded here.'} />
        </Card>
      )}
      {runs.data && runs.data.runs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02]">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Platform</th>
                  <th className="px-3 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Task</th>
                  <th className="px-3 py-2.5 font-medium">Trigger</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Duration</th>
                  <th className="px-3 py-2.5 font-medium">Mode</th>
                  <th className="px-3 py-2.5 font-medium">Error</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {runs.data.runs.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => openRun(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openRun(r.id)}
                    className="cursor-pointer transition hover:bg-white/[0.025] focus:bg-white/[0.04] focus:outline-none"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">
                      <div>{formatDateTime(r.startedAt ?? r.queuedAt)}</div>
                      <div className="font-mono text-[10px] text-slate-600">{r.id}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <PlatformTag platform={platformById(r.platformId)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{r.accountName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-100">{taskLabel(r.taskType, r.taskName)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={r.trigger === 'manual' ? 'violet' : r.trigger === 'missed' ? 'amber' : r.trigger === 'retry' ? 'cyan' : 'blue'}>{TRIGGER_LABEL[r.trigger]}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <RunStatusPill status={r.status} />
                      {r.status === 'waiting_for_review' && r.reviewCount > 0 && <div className="mt-1 text-[11px] text-amber-300">{r.reviewCount} to review</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{r.status === 'running' ? '…' : formatDuration(r.durationMs)}</td>
                    <td className="px-3 py-2.5 capitalize text-slate-400">{r.mode}</td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      {r.error ? (
                        <span className="line-clamp-2 text-xs text-rose-300/90" title={r.error}>
                          {r.errorCode ? <span className="font-mono">{r.errorCode}: </span> : null}
                          {r.error}
                        </span>
                      ) : r.status === 'running' && r.currentStep ? (
                        <span className="line-clamp-1 text-xs text-indigo-200">{r.currentStep}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <IconButton icon="chevronRight" label={`Details for ${r.id}`} onClick={(e) => (e.stopPropagation(), openRun(r.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2.5 text-xs text-slate-400">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <IconButton icon="chevronLeft" label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} />
              <span className="px-2">
                Page {page + 1} / {pages}
              </span>
              <IconButton icon="chevronRight" label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} />
            </div>
          </div>
        </Card>
      )}

      {!embedded && runId && <RunDetailsDrawer runId={runId} onClose={() => navigate({ name: 'history' }, { replace: true })} />}
      {embedded && localRunId && <RunDetailsDrawer runId={localRunId} onClose={() => setLocalRunId(null)} />}
    </div>
  );
}
