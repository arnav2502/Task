import { useMemo, useState } from 'react';
import type { Schedule, Task } from '@shared/types/index';
import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { useFeedback } from '../app/feedback';
import { Badge, Button, Card, EmptyState, ErrorBanner, IconButton, SkeletonList, Toggle } from './ui';
import { PlatformMark } from './status';
import { ScheduleFormModal } from './forms/ScheduleForm';
import { formatDateTime, relativeTime } from '../utils/format';

export function SchedulesPanel({ platformId }: { platformId?: string }) {
  const { platformById } = useApp();
  const { toast, fail, confirm } = useFeedback();
  const q = platformId ? { platformId } : {};
  const schedules = useResource(() => api.schedules(q), [platformId], ['schedules:changed', 'account:deleted', 'tasks:changed']);
  const tasks = useResource(() => api.tasks(q), [platformId], ['tasks:changed', 'account:deleted', 'account:update']);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);

  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);

  /** platform → account → schedules */
  const groups = useMemo(() => {
    const out = new Map<string, Map<string, Array<{ s: Schedule; t: Task | undefined }>>>();
    for (const s of schedules.data ?? []) {
      const t = taskById.get(s.taskId);
      const accounts = out.get(s.platformId) ?? new Map();
      accounts.set(s.accountId, [...(accounts.get(s.accountId) ?? []), { s, t }]);
      out.set(s.platformId, accounts);
    }
    return out;
  }, [schedules.data, taskById]);

  const update = async (s: Schedule, patch: Partial<Schedule>) => {
    try {
      const u = await api.updateSchedule(s.id, patch);
      schedules.setData((cur) => cur?.map((x) => (x.id === u.id ? u : x)) ?? cur);
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (s: Schedule) => {
    if (!(await confirm({ title: 'Delete schedule?', message: `“${s.summary}” will stop running.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.deleteSchedule(s.id);
      schedules.setData((cur) => cur?.filter((x) => x.id !== s.id) ?? cur);
      toast('success', 'Schedule deleted');
    } catch (err) {
      fail(err);
    }
  };

  const error = schedules.error ?? tasks.error;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')} disabled={!tasks.data?.length}>
          New schedule
        </Button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void schedules.reload()} />}
      {schedules.loading && !schedules.data && <SkeletonList rows={3} />}
      {schedules.data?.length === 0 && (
        <Card>
          <EmptyState
            icon="schedules"
            title="No schedules"
            description={tasks.data?.length ? 'Create a schedule to run a task automatically — daily, on specific days, or every hour within a window.' : 'Add an account first; its tasks can then be scheduled.'}
            action={
              tasks.data?.length ? (
                <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                  New schedule
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
      {[...groups.entries()].map(([pid, accounts]) => (
        <Card key={pid} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/[0.05] px-5 py-3">
            <PlatformMark platform={platformById(pid)} size="sm" />
            <span className="text-sm font-semibold text-white">{platformById(pid)?.name ?? pid}</span>
          </div>
          {[...accounts.entries()].map(([accountId, rows]) => (
            <div key={accountId}>
              <div className="bg-white/[0.02] px-5 py-2 text-xs font-medium text-slate-400">{rows[0]?.t?.accountName ?? 'Account'}</div>
              <ul className="divide-y divide-white/[0.04]">
                {rows.map(({ s, t }) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <div className="min-w-[200px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{t?.name ?? s.taskType}</span>
                        <Badge tone="indigo">{s.summary}</Badge>
                        {s.mode !== 'default' && <Badge tone="slate">{s.mode}</Badge>}
                        {t && !t.enabled && <Badge tone="amber">Task paused</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                        <span title={formatDateTime(s.nextRunAt)}>Next: {s.enabled ? (s.nextRunAt ? `${formatDateTime(s.nextRunAt)} (${relativeTime(s.nextRunAt)})` : 'none') : 'disabled'}</span>
                        <span>Last: {s.lastRunAt ? formatDateTime(s.lastRunAt) : 'never'}</span>
                      </div>
                    </div>
                    <Toggle size="sm" checked={s.enabled} label={`Enable ${s.summary}`} onChange={(v) => void update(s, { enabled: v })} />
                    <IconButton icon="edit" label="Edit schedule" onClick={() => setEditing(s)} />
                    <IconButton icon="trash" label="Delete schedule" className="hover:text-rose-300" onClick={() => void remove(s)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ))}
      {editing && (
        <ScheduleFormModal
          schedule={editing === 'new' ? undefined : editing}
          platformId={platformId}
          onClose={() => setEditing(null)}
          onSaved={() => void schedules.reload()}
        />
      )}
    </div>
  );
}
