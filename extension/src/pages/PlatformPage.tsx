import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { navigate } from '../app/router';
import { Badge, Button, Callout, Card, EmptyState, ErrorBanner, Skeleton, Tabs } from '../components/ui';
import { PlatformMark } from '../components/status';
import { AccountsPanel } from '../components/AccountsPanel';
import { TasksPanel } from '../components/TasksPanel';
import { SchedulesPanel } from '../components/SchedulesPanel';
import { platformExtensions } from './platforms/registry';
import type { IconName } from '../components/icons';
import { relativeTime } from '../utils/format';

export function PlatformPage({ id, tab }: { id: string; tab?: string }) {
  const { platformById } = useApp();
  const descriptor = platformById(id);
  const { data, error, reload } = useResource(() => api.platform(id), [id], ['run:update', 'account:update', 'account:deleted', 'tasks:changed', 'schedules:changed']);
  const platform = data ?? descriptor;

  if (!platform) {
    if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
    return <Skeleton className="h-40" />;
  }

  if (platform.status !== 'active') {
    return (
      <Card>
        <EmptyState
          icon="clock"
          title={`${platform.name} is coming soon`}
          description={
            <>
              {platform.description}
              {platform.plannedTasks.length > 0 && <span className="mt-2 block">Planned: {platform.plannedTasks.join(' · ')}</span>}
            </>
          }
          action={
            <Button icon="chevronLeft" onClick={() => navigate({ name: 'platforms' })}>
              Back to platforms
            </Button>
          }
        />
      </Card>
    );
  }

  const ext = platformExtensions[id];
  const generic: Array<{ value: string; label: string; icon: IconName }> = [
    { value: 'accounts', label: 'Accounts', icon: 'accounts' },
    { value: 'tasks', label: 'Tasks', icon: 'tasks' },
    { value: 'schedules', label: 'Schedules', icon: 'schedules' },
  ];
  const own = (ext?.tabs ?? []).map((t) => ({ value: t.id, label: t.label, icon: t.icon }));
  const byId = new Map([...generic, ...own].map((t) => [t.value, t]));
  const order = ext?.tabOrder ?? ['accounts', 'tasks', ...own.map((t) => t.value), 'schedules'];
  const tabs = order.map((v) => byId.get(v)).filter((t): t is { value: string; label: string; icon: IconName } => !!t);
  const current = tabs.some((t) => t.value === tab) ? tab! : (tabs[0]?.value ?? 'accounts');
  const ExtTab = ext?.tabs?.find((t) => t.id === current)?.component;
  const a = data?.activity;

  return (
    <div>
      <button type="button" onClick={() => navigate({ name: 'platforms' })} className="mb-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
        ← Platforms
      </button>
      <div className="mb-6 overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-800/80 shadow-card">
        <div className="relative px-6 py-5" style={{ background: `radial-gradient(ellipse at top left, ${platform.accent}22, transparent 60%)` }}>
          <div className="flex flex-wrap items-center gap-4">
            <PlatformMark platform={platform} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-white">{platform.name}</h1>
                <Badge tone="green" dot>
                  Active
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-slate-400">{platform.tagline}</p>
            </div>
            {platform.website && (
              <a href={platform.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                {new URL(platform.website).host}
              </a>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: 'Accounts', value: a ? `${a.connectedAccounts}/${a.accounts}` : '—', hint: 'connected' },
              { label: 'Tasks on', value: a ? `${a.enabledTasks}/${a.tasks}` : '—' },
              { label: 'Runs today', value: a?.runsToday ?? '—' },
              { label: 'Success rate', value: a?.successRate === null || a?.successRate === undefined ? '—' : `${a.successRate}%`, hint: '7 days' },
              ...(a?.metrics ?? []).slice(0, 3).map((m) => ({ label: m.label, value: m.value, hint: m.hint })),
            ].map((s: { label: string; value: string | number; hint?: string }) => (
              <div key={s.label} className="rounded-lg bg-ink-900/60 px-3 py-2 ring-1 ring-inset ring-white/[0.05]" title={s.hint}>
                <div className="truncate text-[11px] text-slate-500">{s.label}</div>
                <div className="text-lg font-semibold text-white">{s.value}</div>
              </div>
            ))}
          </div>
          {a && (
            <div className="mt-3 flex gap-5 text-xs text-slate-500">
              <span>Last run {relativeTime(a.lastRunAt)}</span>
              <span>Next run {a.nextRunAt ? relativeTime(a.nextRunAt) : '—'}</span>
            </div>
          )}
        </div>
      </div>

      {platform.notes.length > 0 && current === tabs[0]?.value && (
        <div className="mb-5">
          <Callout tone="indigo" icon="info" title={`About ${platform.name}`}>
            <ul className="list-disc space-y-0.5 pl-4">
              {platform.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      <Tabs value={current} onChange={(v) => navigate({ name: 'platform', id, tab: v }, { replace: true })} tabs={tabs} />

      {ExtTab ? (
        <ExtTab platform={platform} />
      ) : (
        <>
          {current === 'accounts' && <AccountsPanel platformId={id} />}
          {current === 'tasks' && <TasksPanel platformId={id} />}
          {current === 'schedules' && <SchedulesPanel platformId={id} />}
        </>
      )}
    </div>
  );
}
