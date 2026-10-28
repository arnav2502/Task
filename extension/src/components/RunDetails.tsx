import { reviewHref } from '../pages/platforms/registry';
import { useEffect, useRef, useState } from 'react';
import type { LogLevel, RunDetails as RunDetailsT, RunLogLine, TimelineEntry } from '@shared/types/index';
import { RUN_STAGES } from '@shared/constants/index';
import { api } from '../services/api';
import { useApp, useLive } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { Badge, Button, Drawer, ErrorBanner, IconButton, Skeleton, Stat } from './ui';
import { Icon } from './icons';
import { PlatformTag, RunStatusPill } from './status';
import { cx, formatClock, formatDateTime, formatDuration, taskLabel, TRIGGER_LABEL } from '../utils/format';

const LEVEL: Record<LogLevel, { tag: string; cls: string }> = {
  debug: { tag: 'DEBUG', cls: 'text-slate-500' },
  info: { tag: 'INFO ', cls: 'text-sky-300' },
  success: { tag: 'OK   ', cls: 'text-emerald-300' },
  warn: { tag: 'WARN ', cls: 'text-amber-300' },
  error: { tag: 'ERROR', cls: 'text-rose-300' },
};

const STAGE_LABEL: Record<string, string> = {
  STARTED: 'Started',
  LOGIN_CHECK: 'Login check',
  TASK_EXECUTION: 'Task execution',
  VERIFICATION: 'Verification',
  COMPLETED: 'Completed',
};

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const list = entries.length ? entries : RUN_STAGES.map((stage) => ({ stage, state: 'pending' as const, startedAt: null, endedAt: null }));
  return (
    <ol className="flex flex-wrap items-start gap-y-3">
      {list.map((e, i) => {
        const dot = {
          done: 'bg-emerald-400 ring-emerald-400/30',
          active: 'bg-indigo-400 ring-indigo-400/40 animate-pulse',
          failed: 'bg-rose-400 ring-rose-400/30',
          skipped: 'bg-slate-600 ring-slate-500/20',
          pending: 'bg-ink-600 ring-white/10',
        }[e.state];
        return (
          <li key={e.stage} className="flex min-w-[120px] flex-1 items-start">
            <div className="flex flex-col items-center">
              <span className={cx('h-3 w-3 rounded-full ring-4', dot)} />
            </div>
            <div className="ml-2 min-w-0 flex-1">
              <div className={cx('text-xs font-medium', e.state === 'pending' || e.state === 'skipped' ? 'text-slate-500' : 'text-slate-200')}>{STAGE_LABEL[e.stage] ?? e.stage}</div>
              <div className="text-[11px] text-slate-500">{e.startedAt ? formatClock(e.startedAt) : e.state === 'skipped' ? 'skipped' : '—'}</div>
            </div>
            {i < list.length - 1 && <span className="mx-2 mt-1.5 hidden h-px flex-1 bg-white/10 xl:block" />}
          </li>
        );
      })}
    </ol>
  );
}

export function RunDetailsDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { platformById } = useApp();
  const { toast, fail } = useFeedback();
  const [run, setRun] = useState<RunDetailsT | null>(null);
  const [logs, setLogs] = useState<RunLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [shotOpen, setShotOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    try {
      const r = await api.run(runId);
      setRun(r);
      setLogs((cur) => {
        const ids = new Set(r.logs.map((l) => l.id));
        return [...r.logs, ...cur.filter((l) => !ids.has(l.id) && l.id > (r.logs.at(-1)?.id ?? 0))];
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    setRun(null);
    setLogs([]);
    setShot(null);
    void load();
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useLive((m) => {
    if (m.type === 'run:log' && m.line.runId === runId) {
      setLogs((cur) => (cur.some((l) => l.id === m.line.id) ? cur : [...cur, m.line]));
    } else if (m.type === 'run:update' && m.run.id === runId) {
      setRun((cur) => (cur ? { ...cur, ...m.run } : cur));
      // Timeline is computed by the service; refresh it shortly after a change.
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => void load(), 400);
    }
  });

  // Screenshot once available
  useEffect(() => {
    let url: string | null = null;
    if (run?.hasScreenshot) {
      api
        .screenshotUrl(run.id)
        .then((u) => {
          url = u;
          setShot(u);
        })
        .catch(() => setShot(null));
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [run?.id, run?.hasScreenshot, run?.completedAt]);

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, follow]);

  const active = run?.status === 'queued' || run?.status === 'running';
  const platform = run ? platformById(run.platformId) : undefined;

  const copyLog = async () => {
    const text = logs.map((l) => `[${formatClock(l.ts)}] ${LEVEL[l.level].tag} ${l.message}`).join('\n');
    await navigator.clipboard.writeText(text);
    toast('info', 'Log copied to clipboard');
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const r = await api.cancelRun(runId);
      toast(r.cancelled ? 'success' : 'info', r.cancelled ? 'Cancelling run…' : 'Run already finished');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const r = await api.retryRun(runId);
      toast('success', `Retry queued as ${r.id}`);
      navigate({ name: 'history', runId: r.id });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer onClose={onClose} label={`Run details ${runId}`}>
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Icon name="terminal" size={14} /> Run details
          </div>
          <h2 className="mt-0.5 truncate font-mono text-base font-semibold text-white">{runId}</h2>
          {run && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <RunStatusPill status={run.status} />
              <span className="text-slate-500">·</span>
              <PlatformTag platform={platform} />
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">{run.accountName}</span>
              <span className="text-slate-500">·</span>
              <span className="font-medium text-slate-100">{taskLabel(run.taskType, run.taskName)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active && (
            <Button variant="danger" size="sm" icon="stop" onClick={cancel} loading={busy}>
              Cancel
            </Button>
          )}
          {run && !active && (
            <Button size="sm" icon="refresh" onClick={retry} loading={busy}>
              Retry
            </Button>
          )}
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {!run && !error && (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        )}
        {run && (
          <>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/[0.06] bg-ink-800/60 p-4 sm:grid-cols-4">
              <Stat label="Trigger" value={TRIGGER_LABEL[run.trigger]} />
              <Stat label="Mode" value={<span className="capitalize">{run.mode}</span>} />
              <Stat label="Attempt" value={`${run.attempt} / ${run.maxAttempts}`} />
              <Stat label="Duration" value={run.durationMs !== null ? formatDuration(run.durationMs) : active ? 'Running…' : '—'} />
              <Stat label="Queued" value={formatDateTime(run.queuedAt)} />
              <Stat label="Started" value={formatDateTime(run.startedAt)} />
              <Stat label="Finished" value={formatDateTime(run.completedAt)} />
              <Stat label="Priority" value={run.priority} />
            </div>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Timeline</h3>
              <Timeline entries={run.timeline} />
              {active && run.currentStep && (
                <div className="mt-3 flex items-center gap-2 text-sm text-indigo-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                  {run.currentStep}
                </div>
              )}
            </section>

            {(run.error || run.status === 'action_required') && (
              <div className={cx('rounded-xl border px-4 py-3', run.status === 'action_required' ? 'border-amber-400/30 bg-amber-500/10' : 'border-rose-500/30 bg-rose-500/10')}>
                <div className={cx('flex items-center gap-2 text-sm font-semibold', run.status === 'action_required' ? 'text-amber-200' : 'text-rose-200')}>
                  <Icon name={run.status === 'action_required' ? 'hand' : 'xCircle'} size={16} />
                  {run.status === 'action_required' ? 'Your action is required' : 'Error'}
                  {run.errorCode && <Badge tone={run.status === 'action_required' ? 'amber' : 'red'}>{run.errorCode}</Badge>}
                </div>
                {run.error && <p className="mt-1 text-sm text-slate-200">{run.error}</p>}
                {run.status === 'action_required' && (
                  <p className="mt-1 text-xs text-amber-100/80">Open Accounts and click “Connect” to finish the verification in a visible browser window.</p>
                )}
              </div>
            )}

            {run.status === 'waiting_for_review' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                  <Icon name="hand" size={16} />
                  {run.reviewCount > 0 ? `${run.reviewCount} item${run.reviewCount === 1 ? '' : 's'} waiting for your review` : 'Prepared items are waiting for your review'}
                </div>
                {reviewHref(run.platformId, run.taskId) && (
                  <a href={reviewHref(run.platformId, run.taskId)!} className="text-sm font-semibold text-amber-100 hover:underline">
                    Review now →
                  </a>
                )}
              </div>
            )}
            {run.resultMessage && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-100">
                <span className="font-semibold">Result: </span>
                {run.resultMessage}
              </div>
            )}

            {run.result && Object.keys(run.result).length > 0 && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(run.result).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dt>
                    <dd className="truncate text-sm text-slate-100" title={String(v)}>
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Live log {active && <span className="ml-1 normal-case text-indigo-300">· streaming</span>}
                </h3>
                <div className="flex items-center gap-1">
                  <label className="mr-2 flex items-center gap-1.5 text-xs text-slate-400">
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-indigo-500" />
                    Auto-scroll
                  </label>
                  <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyLog()} disabled={!logs.length}>
                    Copy
                  </Button>
                </div>
              </div>
              <div ref={logRef} className="h-80 overflow-y-auto rounded-xl border border-white/[0.06] bg-ink-950 p-3 font-mono text-[12px] leading-relaxed" role="log" aria-live="polite">
                {logs.length === 0 ? (
                  <div className="text-slate-600">{run.status === 'queued' ? 'Waiting in queue…' : 'No log lines.'}</div>
                ) : (
                  logs.map((l) => (
                    <div key={l.id} className="whitespace-pre-wrap break-words">
                      <span className="text-slate-600">[{formatClock(l.ts)}]</span> <span className={LEVEL[l.level].cls}>{LEVEL[l.level].tag}</span>{' '}
                      <span className={l.level === 'error' ? 'text-rose-200' : 'text-slate-200'}>{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {run.hasScreenshot && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Screenshot</h3>
                {shot ? (
                  <button type="button" onClick={() => setShotOpen(true)} className="block overflow-hidden rounded-xl border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
                    <img src={shot} alt={`Screenshot of ${runId}`} className="max-h-72 w-full object-cover object-top" />
                  </button>
                ) : (
                  <Skeleton className="h-48" />
                )}
              </section>
            )}
          </>
        )}
      </div>
      {shotOpen && shot && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6" onClick={() => setShotOpen(false)} role="dialog" aria-label="Screenshot">
          <img src={shot} alt="Run screenshot full size" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </Drawer>
  );
}
