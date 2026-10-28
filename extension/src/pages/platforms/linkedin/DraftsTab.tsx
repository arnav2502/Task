/**
 * Connection Drafts — the review screen. Selection only helps you skip or walk through leads;
 * every request is sent from its own confirmation dialog, one lead at a time.
 */
import { useMemo, useState } from 'react';
import type { ConnectionDraft } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Badge, Button, Callout, Card, EmptyState, ErrorBanner, SkeletonList } from '../../../components/ui';
import { cx, relativeTime } from '../../../utils/format';
import { ConnectDialog, NoteDialog } from './ConnectDialog';
import { DegreeBadge, leadSubtitle, tabHref, useHashQuery } from './common';
import { useLinkedInTasks } from './TasksTab';

export function DraftsTab() {
  const { toast, fail, confirm } = useFeedback();
  const query = useHashQuery();
  const taskId = query.get('task') ?? undefined;
  const tasks = useLinkedInTasks();
  const { data, error, loading, reload } = useResource(
    async () => {
      const [pending, sending, failed] = await Promise.all([
        api.linkedin.drafts({ status: 'pending', taskId }),
        api.linkedin.drafts({ status: 'confirmed', taskId }),
        api.linkedin.drafts({ status: 'failed', taskId }),
      ]);
      return { pending, sending, failed };
    },
    [taskId],
    ['run:update', 'tasks:changed'],
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<ConnectionDraft | null>(null);
  const [connect, setConnect] = useState<{ draft: ConnectionDraft; queue?: ConnectionDraft[]; index?: number } | null>(null);

  const pending = useMemo(() => (data?.pending ?? []).filter((d) => !sendingIds.has(d.id)), [data, sendingIds]);
  const taskName = taskId ? tasks.data?.find((t) => t.task.id === taskId)?.task.name : undefined;
  const toggle = (id: number) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const skip = async (d: ConnectionDraft) => {
    try {
      await api.linkedin.skip(d.leadId);
      toast('success', `${d.lead.name} skipped`);
      void reload();
    } catch (err) {
      fail(err);
    }
  };
  const skipSelected = async () => {
    const ids = pending.filter((d) => selected.has(d.id)).map((d) => d.leadId);
    if (!ids.length) return;
    if (!(await confirm({ title: `Skip ${ids.length} lead(s)?`, message: 'They will not be offered for connection again.', confirmLabel: 'Skip' }))) return;
    try {
      await api.linkedin.bulk(ids, 'skip');
      setSelected(new Set());
      toast('success', `${ids.length} lead(s) skipped`);
      void reload();
    } catch (err) {
      fail(err);
    }
  };
  /** Walk through the selected drafts one confirmation dialog at a time. */
  const reviewSelected = () => {
    const queue = pending.filter((d) => selected.has(d.id));
    if (queue.length) setConnect({ draft: queue[0]!, queue, index: 0 });
  };
  const advance = () => {
    if (!connect?.queue) return setConnect(null);
    const nextIndex = (connect.index ?? 0) + 1;
    const nextDraft = connect.queue[nextIndex];
    setConnect(nextDraft ? { draft: nextDraft, queue: connect.queue, index: nextIndex } : null);
  };

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <SkeletonList rows={4} />;
  const sending = [...(data?.sending ?? []), ...(data?.pending ?? []).filter((d) => sendingIds.has(d.id))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Connection requests</h2>
          <p className="text-sm text-slate-400">
            {pending.length} pending review{taskName ? ` · ${taskName}` : ''}
            {taskId && (
              <a href={tabHref('drafts')} className="ml-2 text-indigo-300 hover:underline">
                Show all tasks
              </a>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon="check" disabled={!pending.length} onClick={() => setSelected(new Set(pending.map((d) => d.id)))}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" icon="x" disabled={!selected.size} onClick={() => setSelected(new Set())}>
            Deselect all
          </Button>
          <Button size="sm" variant="secondary" icon="x" disabled={!selected.size} onClick={() => void skipSelected()}>
            Skip selected
          </Button>
          <Button size="sm" variant="primary" icon="eye" disabled={!selected.size} onClick={reviewSelected}>
            Review selected ({selected.size})
          </Button>
        </div>
      </div>

      <Callout tone="indigo" icon="shield">
        Nothing is sent automatically. Each request is sent only when you press <strong>Send Connection Request</strong> in its own confirmation — “Review selected” walks
        through them one by one.
      </Callout>

      {pending.length === 0 && sending.length === 0 && (
        <Card>
          <EmptyState
            icon="inbox"
            title="Nothing to review"
            description="When a lead task prepares connection candidates they appear here for you to edit, skip or confirm."
            action={
              <Button variant="primary" icon="search" onClick={() => (location.hash = tabHref('finder'))}>
                Open Lead Finder
              </Button>
            }
          />
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {pending.map((d) => (
          <Card key={d.id} className={cx('p-4', selected.has(d.id) && 'ring-1 ring-indigo-400/40')}>
            <div className="flex items-start gap-3">
              <input type="checkbox" aria-label={`Select ${d.lead.name}`} className="mt-1 accent-indigo-500" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={d.lead.profileUrl} target="_blank" rel="noreferrer" className="font-semibold text-white hover:underline">
                    {d.lead.name}
                  </a>
                  <DegreeBadge degree={d.lead.connectionDegree} />
                </div>
                <div className="text-sm text-slate-300">{leadSubtitle(d.lead) || '—'}</div>
                {d.lead.location && <div className="text-xs text-slate-500">{d.lead.location}</div>}
                <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm ring-1 ring-inset ring-white/[0.06]">
                  {d.note ? (
                    <>
                      <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">Suggested note</div>
                      <div className="whitespace-pre-wrap text-slate-200">{d.note}</div>
                    </>
                  ) : (
                    <span className="text-slate-500">No note</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(d)}>
                    Edit note
                  </Button>
                  <Button size="sm" variant="ghost" icon="x" onClick={() => void skip(d)}>
                    Skip
                  </Button>
                  <Button size="sm" variant="primary" icon="send" className="ml-auto" onClick={() => setConnect({ draft: d })}>
                    Confirm &amp; Send
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {sending.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-300">Sending</h3>
          <Card className="divide-y divide-white/[0.04]">
            {sending.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-slate-200">{d.lead.name}</span>
                <Badge tone="indigo" dot pulse>
                  Sending…
                </Badge>
              </div>
            ))}
          </Card>
        </section>
      )}

      {(data?.failed.length ?? 0) > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-300">Couldn’t send</h3>
          <Card className="divide-y divide-white/[0.04]">
            {data!.failed.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="text-slate-200">{d.lead.name}</div>
                  <div className="truncate text-xs text-rose-300/90" title={d.error ?? undefined}>
                    {d.error ?? 'Failed'} · {relativeTime(d.updatedAt)}
                  </div>
                </div>
                <Button size="sm" variant="secondary" icon="send" onClick={() => setConnect({ draft: d })}>
                  Try again
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      {editing && <NoteDialog lead={editing.lead} initialNote={editing.note} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
      {connect && (
        <ConnectDialog
          key={connect.draft.id}
          lead={connect.draft.lead}
          initialNote={connect.draft.note}
          onClose={() => setConnect(null)}
          walkthrough={connect.queue ? { index: connect.index ?? 0, total: connect.queue.length, onNext: advance } : undefined}
          onSent={() => {
            setSendingIds((s) => new Set(s).add(connect.draft.id));
            setSelected((s) => {
              const n = new Set(s);
              n.delete(connect.draft.id);
              return n;
            });
            void reload();
            advance();
          }}
        />
      )}
    </div>
  );
}
