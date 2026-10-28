import { useState } from 'react';
import type { AccountSummary, ValidationCheck } from '@shared/types/index';
import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { Badge, Button, Card, EmptyState, ErrorBanner, IconButton, Modal, SkeletonList, Toggle } from './ui';
import { AccountStatusPill, PlatformMark, RunStatusPill } from './status';
import { AccountFormModal, MODE_LABEL } from './forms/AccountForm';
import { Icon } from './icons';
import { relativeTime, taskLabel } from '../utils/format';

function ValidationModal({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const [checks, setChecks] = useState<ValidationCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setChecks(await api.validate(account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };
  const found = checks?.filter((c) => c.found).length ?? 0;
  return (
    <Modal
      title="Selector health check"
      subtitle={`${account.name} · read-only — nothing is saved on the site`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="shield" onClick={run} loading={running}>
            {checks ? 'Run again' : 'Run check'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-400">
        Opens the account's browser (Background mode), visits the profile page and confirms every element the automation relies on can still be found. The account must be idle.
      </p>
      {error && <ErrorBanner message={error} />}
      {running && <p className="text-sm text-indigo-200">Checking… this can take up to a minute.</p>}
      {checks && (
        <>
          <div className="mb-3 text-sm">
            <Badge tone={found === checks.length ? 'green' : 'amber'}>
              {found}/{checks.length} found
            </Badge>
          </div>
          <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
            {checks.map((c) => (
              <li key={c.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Icon name={c.found ? 'checkCircle' : 'xCircle'} size={16} className={c.found ? 'text-emerald-400' : 'text-rose-400'} />
                <div className="min-w-0 flex-1">
                  <div className="text-slate-200">{c.description}</div>
                  <div className="truncate font-mono text-[11px] text-slate-500">{c.matched ?? c.key}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

export function AccountsPanel({ platformId, showAdd = true }: { platformId?: string; showAdd?: boolean }) {
  const { platformById, platforms } = useApp();
  const { toast, fail, confirm } = useFeedback();
  const { data, error, loading, reload, setData } = useResource(() => api.accounts(platformId), [platformId], ['account:update', 'account:deleted', 'run:update', 'schedules:changed', 'tasks:changed']);
  const [editing, setEditing] = useState<AccountSummary | 'new' | null>(null);
  const [validating, setValidating] = useState<AccountSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast('success', success);
      void reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const hasActivePlatform = platforms.some((p) => p.status === 'active' && (!platformId || p.id === platformId));

  return (
    <div className="space-y-3">
      {showAdd && (
        <div className="flex justify-end">
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')} disabled={!hasActivePlatform}>
            Add account
          </Button>
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <SkeletonList rows={3} />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState
            icon="accounts"
            title="No accounts yet"
            description="Add an account, then click Connect once to sign in. TaskPilot keeps the session in an isolated browser profile."
            action={
              showAdd && hasActivePlatform ? (
                <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                  Add account
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
      {data?.map((a) => {
        const p = platformById(a.platformId);
        const caps = p?.capabilities;
        const busyThis = busy?.startsWith(a.id);
        return (
          <Card key={a.id} className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              <PlatformMark platform={p} />
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{a.name}</span>
                  <AccountStatusPill status={a.status} />
                  {!a.enabled && <Badge tone="slate">Automation paused</Badge>}
                  {!a.hasCredentials && caps?.requiresLogin && <Badge tone="amber">No password stored</Badge>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-400">{a.username}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>{p?.name ?? a.platformId}</span>
                  <span>Last checked {relativeTime(a.lastCheckedAt)}</span>
                  <span>Mode: {a.modeOverride ? MODE_LABEL[a.modeOverride] : 'global default'}</span>
                  <span>
                    {a.enabledTaskCount}/{a.taskCount} tasks scheduled-on
                  </span>
                  {a.nextRunAt && <span>Next run {relativeTime(a.nextRunAt)}</span>}
                </div>
                {a.statusMessage && a.status !== 'connected' && <div className="mt-2 text-xs text-amber-200/80">{a.statusMessage}</div>}
                {a.activeRun && (
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'history', runId: a.activeRun!.id })}
                    className="mt-2 inline-flex items-center gap-2 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-200 hover:bg-indigo-500/20"
                  >
                    <RunStatusPill status={a.activeRun.status} />
                    {taskLabel(a.activeRun.taskType, a.activeRun.taskName)}
                    {a.activeRun.currentStep ? ` · ${a.activeRun.currentStep}` : ''}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Automation</span>
                <Toggle
                  checked={a.enabled}
                  label={`Scheduled automation for ${a.name}`}
                  onChange={(v) =>
                    void act(`${a.id}:toggle`, async () => {
                      const u = await api.updateAccount(a.id, { enabled: v });
                      setData((cur) => cur?.map((x) => (x.id === a.id ? { ...x, ...u } : x)) ?? cur);
                    })
                  }
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
              {caps?.supportsConnect && (
                <Button size="sm" variant="primary" icon="link" disabled={busyThis} onClick={() => void act(`${a.id}:connect`, () => api.connect(a.id), 'Opening a browser window — complete the sign-in there')}>
                  Connect
                </Button>
              )}
              <Button size="sm" icon="login" disabled={busyThis} onClick={() => void act(`${a.id}:test`, () => api.testLogin(a.id), 'Login test queued')}>
                Test login
              </Button>
              <Button
                size="sm"
                icon="unlink"
                disabled={busyThis}
                onClick={async () => {
                  if (await confirm({ title: 'Disconnect account?', message: `This clears the saved browser session for ${a.name}. The stored password is kept; the next run logs in again.`, confirmLabel: 'Disconnect' }))
                    void act(`${a.id}:disc`, () => api.disconnect(a.id), `${a.name} disconnected`);
                }}
              >
                Disconnect
              </Button>
              {caps?.supportsValidation && (
                <Button size="sm" icon="shield" variant="ghost" onClick={() => setValidating(a)}>
                  Validate selectors
                </Button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <IconButton icon="edit" label={`Edit ${a.name}`} onClick={() => setEditing(a)} />
                <IconButton
                  icon="trash"
                  label={`Delete ${a.name}`}
                  className="hover:text-rose-300"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete ${a.name}?`,
                        message: 'This permanently removes the account, its stored password, browser profile, tasks, schedules and platform data. Run history is kept until log retention removes it.',
                        confirmLabel: 'Delete account',
                        danger: true,
                      })
                    )
                      void act(`${a.id}:del`, () => api.deleteAccount(a.id), `${a.name} deleted`);
                  }}
                />
              </div>
            </div>
          </Card>
        );
      })}
      {editing && (
        <AccountFormModal
          account={editing === 'new' ? undefined : editing}
          defaultPlatformId={platformId}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}
      {validating && <ValidationModal account={validating} onClose={() => setValidating(null)} />}
    </div>
  );
}
