import { useEffect, useState } from 'react';
import type { PlatformDescriptor, Task } from '@shared/types/index';
import { NAUKRI_TASKS, type SharedJobStatus } from '@shared/types/naukri';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { navigate } from '../../../app/router';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorBanner, Select, Skeleton, type Tone } from '../../../components/ui';
import { ConfigForm, TaskConfigModal } from '../../../components/forms/ConfigFields';
import { RunStatusPill } from '../../../components/status';
import { formatDateTime, relativeTime } from '../../../utils/format';

const PLATFORM = 'naukri';
const STATUS_TONE: Record<SharedJobStatus, Tone> = { pending: 'amber', shared: 'green', failed: 'red', skipped: 'slate' };

function AccountShareRow({ task, sharedToday, descriptor, onChanged }: { task: Task; sharedToday: number; descriptor: PlatformDescriptor['tasks'][number] | undefined; onChanged: () => void }) {
  const { toast, fail, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const limit = typeof task.configuration.dailyLimit === 'number' ? task.configuration.dailyLimit : null;
  const perRun = typeof task.configuration.rolesPerRun === 'number' ? task.configuration.rolesPerRun : null;
  const pct = limit ? Math.min(100, Math.round((sharedToday / limit) * 100)) : 0;
  const active = task.status === 'queued' || task.status === 'running';

  const run = async () => {
    if (!(await confirm({ title: `Share interest now for ${task.accountName}?`, message: `Up to ${perRun ?? 'the configured number of'} role(s) will be applied to now, one at a time with random pauses.`, confirmLabel: 'Share now' }))) return;
    setBusy(true);
    try {
      const r = await api.runTask(task.id);
      toast('success', `Share Interest queued (${r.id})`);
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-3">
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-100">{task.accountName}</span>
          {task.hasConfigOverride && <Badge tone="violet">Custom limits</Badge>}
          {!task.enabled && <Badge tone="slate">Schedules paused</Badge>}
          <RunStatusPill status={task.status} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400" style={{ width: `${pct}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs text-slate-400">
            {sharedToday}
            {limit ? ` / ${limit}` : ''} shared today{perRun ? ` · ${perRun} per run` : ''}
          </span>
        </div>
      </div>
      <Button size="sm" variant="primary" icon="send" onClick={() => void run()} loading={busy} disabled={active}>
        {active ? 'Running…' : 'Share now'}
      </Button>
      <Button size="sm" icon="sliders" onClick={() => setEditing(true)}>
        Limits
      </Button>
      {task.hasConfigOverride && (
        <Button
          size="sm"
          variant="ghost"
          icon="rotate"
          onClick={async () => {
            try {
              await api.updateTask(task.id, { resetConfiguration: true });
              onChanged();
            } catch (err) {
              fail(err);
            }
          }}
        >
          Use defaults
        </Button>
      )}
      {editing && descriptor && <TaskConfigModal task={task} descriptor={descriptor} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </li>
  );
}

export function ShareInterestTab({ platform }: { platform: PlatformDescriptor }) {
  const { toast, fail } = useFeedback();
  const descriptor = platform.tasks.find((t) => t.type === NAUKRI_TASKS.SHARE_INTEREST);
  const [accountFilter, setAccountFilter] = useState('');
  const defaults = useResource(() => api.platformTaskConfig(PLATFORM, NAUKRI_TASKS.SHARE_INTEREST), []);
  const tasks = useResource(() => api.tasks({ platformId: PLATFORM }), [], ['tasks:changed', 'run:update', 'account:update', 'account:deleted']);
  const jobs = useResource(() => api.naukri.sharedJobs({ accountId: accountFilter || undefined, limit: 300 }), [accountFilter], ['run:update']);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaults.data && !draft) setDraft({ ...defaults.data.configuration });
  }, [defaults.data, draft]);

  const shareTasks = (tasks.data ?? []).filter((t) => t.taskType === NAUKRI_TASKS.SHARE_INTEREST);
  const dirty = !!draft && !!defaults.data && JSON.stringify(draft) !== JSON.stringify(defaults.data.configuration);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api.savePlatformTaskConfig(PLATFORM, NAUKRI_TASKS.SHARE_INTEREST, draft);
      defaults.setData(r);
      setDraft({ ...r.configuration });
      toast('success', 'Share Interest defaults saved');
      void tasks.reload();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Callout title="Sharing interest is applying">
        On Naukri, “Share interest” on an Early access role submits a job application. TaskPilot shares roles one at a time in random order with random pauses, never shares the
        same role twice, and stops at your per-run and daily limits.
      </Callout>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader
            icon="sliders"
            title="Default limits & keywords"
            subtitle="Applies to accounts without custom limits."
            action={
              <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>
                Save
              </Button>
            }
          />
          <div className="px-5 py-4">
            {defaults.error && <ErrorBanner message={defaults.error} onRetry={() => void defaults.reload()} />}
            {!draft || !descriptor ? <Skeleton className="h-64" /> : <ConfigForm fields={descriptor.configFields} values={draft} onChange={setDraft} />}
          </div>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader icon="accounts" title="Accounts" subtitle="Today's progress against each account's daily limit." />
          {tasks.loading && !tasks.data ? (
            <Skeleton className="m-5 h-20" />
          ) : shareTasks.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-slate-500">No Naukri accounts yet.</div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {shareTasks.map((t) => (
                <AccountShareRow
                  key={t.id}
                  task={t}
                  descriptor={descriptor}
                  sharedToday={jobs.data?.sharedToday[t.accountId] ?? 0}
                  onChanged={() => {
                    void tasks.reload();
                    void jobs.reload();
                  }}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          icon="history"
          title="Shared roles history"
          subtitle="Every role TaskPilot tried to share. This history is what prevents duplicate applications, so it is never auto-deleted."
          action={
            shareTasks.length > 1 ? (
              <Select aria-label="Filter by account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="w-48">
                <option value="">All accounts</option>
                {shareTasks.map((t) => (
                  <option key={t.accountId} value={t.accountId}>
                    {t.accountName}
                  </option>
                ))}
              </Select>
            ) : undefined
          }
        />
        {jobs.error && (
          <div className="p-5">
            <ErrorBanner message={jobs.error} onRetry={() => void jobs.reload()} />
          </div>
        )}
        {jobs.loading && !jobs.data && <Skeleton className="m-5 h-32" />}
        {jobs.data && jobs.data.jobs.length === 0 && <EmptyState icon="send" title="No roles shared yet" description="Shared roles appear here after the first Share Interest run." />}
        {jobs.data && jobs.data.jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2 font-medium">When</th>
                  {shareTasks.length > 1 && <th className="px-3 py-2 font-medium">Account</th>}
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Experience · Location</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {jobs.data.jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-400" title={formatDateTime(j.sharedAt)}>
                      {relativeTime(j.sharedAt)}
                    </td>
                    {shareTasks.length > 1 && <td className="px-3 py-2.5 text-slate-300">{shareTasks.find((t) => t.accountId === j.accountId)?.accountName ?? '—'}</td>}
                    <td className="px-3 py-2.5 font-medium text-slate-100">{j.title}</td>
                    <td className="px-3 py-2.5 text-slate-300">{j.company ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400">{[j.experience, j.location].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[j.status]} dot>
                        {j.status}
                      </Badge>
                      {j.message && <div className="mt-0.5 max-w-[240px] truncate text-xs text-slate-500" title={j.message}>{j.message}</div>}
                    </td>
                    <td className="px-5 py-2.5">
                      {j.runId ? (
                        <button type="button" className="font-mono text-xs text-indigo-300 hover:underline" onClick={() => navigate({ name: 'history', runId: j.runId! })}>
                          {j.runId}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
