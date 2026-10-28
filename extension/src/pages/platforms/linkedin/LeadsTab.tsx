/** Every discovered lead (de-duplicated by profile). Bulk actions only review or skip — never send. */
import { useEffect, useState } from 'react';
import type { Lead, LeadStatus } from '@shared/types/linkedin';
import { LEAD_STATUSES } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Button, Card, EmptyState, ErrorBanner, IconButton, Input, Select, SkeletonList } from '../../../components/ui';
import { cx, formatDateTime, relativeTime } from '../../../utils/format';
import { ConnectDialog, NoteDialog } from './ConnectDialog';
import { DegreeBadge, LEAD_STATUS_LABEL, LeadStatusBadge, canConnect, useHashQuery } from './common';
import { useLinkedInTasks } from './TasksTab';

const PAGE = 25;

export function LeadsTab() {
  const { toast, fail } = useFeedback();
  const query = useHashQuery();
  const [status, setStatus] = useState<LeadStatus | ''>((query.get('status') as LeadStatus | null) ?? '');
  const [taskId, setTaskId] = useState(query.get('task') ?? '');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [connecting, setConnecting] = useState<{ lead: Lead; note: string | null } | null>(null);
  const [noting, setNoting] = useState<{ lead: Lead; note: string | null } | null>(null);
  const tasks = useLinkedInTasks();

  // Debounce the text search.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const filters = { status: status || undefined, taskId: taskId || undefined, q: q || undefined, limit: PAGE, offset: page * PAGE };
  const key = JSON.stringify(filters);
  const { data, error, loading, reload } = useResource(() => api.linkedin.leads(filters), [key], ['run:update', 'tasks:changed']);
  useEffect(() => setSelected(new Set()), [key]);

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const allOnPage = leads.length > 0 && leads.every((l) => selected.has(l.id));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast('success', ok);
      void reload();
    } catch (err) {
      fail(err);
    }
  };
  const bulk = (action: 'review' | 'skip') =>
    act(async () => {
      const r = await api.linkedin.bulk([...selected], action);
      setSelected(new Set());
      return r;
    }, action === 'skip' ? `${selected.size} lead(s) skipped` : `${selected.size} lead(s) marked reviewed`);

  const view = (l: Lead) => {
    window.open(l.profileUrl, '_blank', 'noopener');
    if (l.status === 'NEW') void api.linkedin.review(l.id).then(() => reload()).catch(() => {});
  };
  const withDraft = async (l: Lead, then: (note: string | null) => void) => {
    try {
      const d = await api.linkedin.lead(l.id);
      then(d.draft?.note ?? null);
    } catch {
      then(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input aria-label="Search leads" placeholder="Search name, title, company…" value={text} onChange={(e) => setText(e.target.value)} />
          <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value as LeadStatus | ''), setPage(0))}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Task" value={taskId} onChange={(e) => (setTaskId(e.target.value), setPage(0))}>
            <option value="">All lead tasks</option>
            {(tasks.data ?? []).map(({ task }) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </Select>
          <Button variant="ghost" icon="x" disabled={!status && !taskId && !text} onClick={() => (setStatus(''), setTaskId(''), setText(''), setPage(0))}>
            Clear filters
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="ghost" icon="check" disabled={!leads.length} onClick={() => setSelected(new Set(leads.map((l) => l.id)))}>
          Select all
        </Button>
        <Button size="sm" variant="ghost" icon="x" disabled={!selected.size} onClick={() => setSelected(new Set())}>
          Deselect all
        </Button>
        <span className="text-xs text-slate-500">{selected.size} selected</span>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" icon="eye" disabled={!selected.size} onClick={() => void bulk('review')}>
          Mark reviewed
        </Button>
        <Button size="sm" variant="secondary" icon="x" disabled={!selected.size} onClick={() => void bulk('skip')}>
          Skip selected
        </Button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <SkeletonList rows={6} />}
      {data && leads.length === 0 && (
        <Card>
          <EmptyState icon="accounts" title={status || taskId || q ? 'No leads match' : 'No leads yet'} description="Run a lead task from Lead Finder or Tasks — discovered people appear here, de-duplicated by profile." />
        </Card>
      )}
      {leads.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02]">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      onChange={() => setSelected(allOnPage ? new Set() : new Set(leads.map((l) => l.id)))}
                      className="accent-indigo-500"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="px-3 py-2.5 font-medium">Degree</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Seen</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {leads.map((l) => (
                  <tr key={l.id} className={cx('transition hover:bg-white/[0.02]', selected.has(l.id) && 'bg-indigo-500/[0.05]')}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name}`}
                        checked={selected.has(l.id)}
                        onChange={() =>
                          setSelected((cur) => {
                            const n = new Set(cur);
                            if (n.has(l.id)) n.delete(l.id);
                            else n.add(l.id);
                            return n;
                          })
                        }
                        className="accent-indigo-500"
                      />
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      <div className="font-medium text-white">{l.name}</div>
                      <div className="truncate text-xs text-slate-400" title={l.headline ?? undefined}>
                        {l.jobTitle ?? l.headline ?? '—'}
                      </div>
                      {l.lastError && l.status === 'FAILED' && (
                        <div className="truncate text-xs text-rose-300/90" title={l.lastError}>
                          {l.lastError}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{l.company ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400">{l.location ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <DegreeBadge degree={l.connectionDegree} />
                    </td>
                    <td className="px-3 py-2.5">
                      <LeadStatusBadge status={l.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                      <div title={formatDateTime(l.firstSeenAt)}>First {relativeTime(l.firstSeenAt)}</div>
                      <div title={formatDateTime(l.lastSeenAt)}>Last {relativeTime(l.lastSeenAt)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <IconButton icon="external" label={`View ${l.name}'s profile`} onClick={() => view(l)} />
                        <IconButton
                          icon="edit"
                          label={`Add a note for ${l.name}`}
                          disabled={!canConnect(l.status)}
                          onClick={() => void withDraft(l, (note) => setNoting({ lead: l, note }))}
                        />
                        <Button size="sm" variant="secondary" icon="send" disabled={!canConnect(l.status)} onClick={() => void withDraft(l, (note) => setConnecting({ lead: l, note }))}>
                          Connect
                        </Button>
                        <IconButton
                          icon="x"
                          label={`Skip ${l.name}`}
                          disabled={l.status === 'SKIPPED' || !canConnect(l.status)}
                          onClick={() => void act(() => api.linkedin.skip(l.id), `${l.name} skipped`)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2.5 text-xs text-slate-400">
            <span>
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
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

      {connecting && (
        <ConnectDialog
          lead={connecting.lead}
          initialNote={connecting.note}
          onClose={() => setConnecting(null)}
          onSent={() => {
            setConnecting(null);
            void reload();
          }}
        />
      )}
      {noting && <NoteDialog lead={noting.lead} initialNote={noting.note} onClose={() => setNoting(null)} onSaved={() => void reload()} />}
    </div>
  );
}
