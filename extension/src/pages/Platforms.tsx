import { useApp } from '../app/state';
import { navigate } from '../app/router';
import { Badge, PageHeader } from '../components/ui';
import { PlatformMark } from '../components/status';
import { Icon } from '../components/icons';
import { cx } from '../utils/format';

export function PlatformsPage() {
  const { platforms } = useApp();
  return (
    <div>
      <PageHeader eyebrow="Automations" title="Platforms" subtitle="Each platform is an adapter in the local service. Pick one to manage its accounts, tasks and schedules." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {platforms.map((p) => {
          const active = p.status === 'active';
          const body = (
            <>
              <div className="flex items-start gap-4">
                <PlatformMark platform={p} size="lg" muted={!active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{p.name}</h3>
                    {active ? (
                      <Badge tone="green" dot>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="slate" className="uppercase tracking-wide">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">{p.tagline}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-400">{p.description}</p>
              <div className="mt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{active ? 'Tasks' : 'Planned'}</div>
                <ul className="flex flex-wrap gap-1.5">
                  {(active ? p.tasks.map((t) => t.name) : p.plannedTasks).map((t) => (
                    <li key={t} className={cx('rounded-md px-2 py-1 text-xs', active ? 'bg-indigo-500/10 text-indigo-200' : 'bg-white/[0.03] text-slate-500')}>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={cx('mt-5 flex items-center gap-1.5 text-sm font-medium', active ? 'text-indigo-300' : 'text-slate-600')}>
                {active ? (
                  <>
                    Open control center <Icon name="arrowRight" size={15} />
                  </>
                ) : (
                  'Not available yet'
                )}
              </div>
            </>
          );
          return active ? (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate({ name: 'platform', id: p.id })}
              className="group rounded-xl border border-white/[0.06] bg-ink-800/80 p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-indigo-400/30 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              {body}
            </button>
          ) : (
            <div key={p.id} aria-disabled="true" className="cursor-not-allowed rounded-xl border border-dashed border-white/[0.08] bg-ink-850/60 p-5 opacity-75">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
