import { useEffect, useState } from 'react';
import type { QueueItem, QueueSnapshot } from '@shared/types/index';
import { api } from '../services/api';
import { useApp, useLive } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { Card, CardHeader, IconButton } from './ui';
import { PlatformMark, RunStatusPill } from './status';
import { relativeTime } from '../utils/format';

/** Live view of the global queue (running + waiting), across all platforms. */
export function QueuePanel({ initial, compact }: { initial?: QueueSnapshot | null; compact?: boolean }) {
  const { platformById } = useApp();
  const { fail, toast } = useFeedback();
  const [queue, setQueue] = useState<QueueSnapshot | null>(initial ?? null);

  useEffect(() => {
    if (initial) setQueue(initial);
  }, [initial]);
  useEffect(() => {
    if (!initial) api.queue().then(setQueue).catch(() => undefined);
  }, [initial]);
  useLive((m) => {
    if (m.type === 'queue:changed') setQueue(m.queue);
  });

  const cancel = async (item: QueueItem) => {
    try {
      const r = await api.cancelRun(item.runId);
      if (r.cancelled) toast('success', `${item.taskName} cancelled`);
    } catch (err) {
      fail(err);
    }
  };

  const items = queue ? [...queue.running, ...queue.pending] : [];
  return (
    <Card>
      <CardHeader
        icon="layers"
        title="Task queue"
        subtitle={queue ? `${queue.running.length} running · ${queue.pending.length} waiting · up to ${queue.maxConcurrent} accounts at once` : 'Loading…'}
      />
      {items.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-slate-500">Queue is empty — nothing running right now.</div>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {items.slice(0, compact ? 6 : 50).map((it) => (
            <li key={it.runId} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-5 text-center text-xs text-slate-500">{it.position ?? '▶'}</span>
              <PlatformMark platform={platformById(it.platformId)} size="sm" />
              <button type="button" onClick={() => navigate({ name: 'history', runId: it.runId })} className="min-w-0 flex-1 text-left hover:opacity-80">
                <div className="truncate text-sm text-slate-100">{it.taskName}</div>
                <div className="truncate text-xs text-slate-500">
                  {it.accountName} · {it.status === 'running' ? `started ${relativeTime(it.startedAt)}` : `queued ${relativeTime(it.queuedAt)}`}
                  {it.priority >= 100 ? ' · manual' : ''}
                </div>
              </button>
              <RunStatusPill status={it.status} />
              <IconButton icon="stop" label={`Cancel ${it.taskName}`} className="hover:text-rose-300" onClick={() => void cancel(it)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
