import type { Route } from '../../app/router';
import { href } from '../../app/router';
import { useApp } from '../../app/state';
import { Icon, Logo, type IconName } from '../icons';
import { ThemeToggle } from '../ThemeToggle';
import { PlatformMark } from '../status';
import type { PlatformDescriptor } from '@shared/types/index';
import { cx } from '../../utils/format';

interface NavItem {
  route: Route;
  label: string;
  icon: IconName;
  match: Route['name'][];
  badge?: number;
  /** Platform shortcut: shows the platform logo and is active on that platform's page. */
  platform?: PlatformDescriptor;
  /** Custom active test (overrides `match`). */
  isActive?: (r: Route) => boolean;
}

export function Sidebar({ route }: { route: Route }) {
  const { unread, health, liveConnected, connection, platforms } = useApp();
  const active = platforms.filter((p) => p.status === 'active');
  const shortcutIds = new Set(active.map((p) => p.id));
  const platformItems: NavItem[] = active.map((p) => ({
    route: { name: 'platform', id: p.id },
    label: p.name,
    icon: 'platforms',
    match: [],
    platform: p,
    isActive: (r) => r.name === 'platform' && r.id === p.id,
  }));
  const sections: Array<{ title: string | null; items: NavItem[] }> = [
    { title: null, items: [{ route: { name: 'dashboard' }, label: 'Dashboard', icon: 'dashboard', match: ['dashboard'] }] },
    {
      title: 'Automations',
      items: [
        {
          route: { name: 'platforms' },
          label: 'Platforms',
          icon: 'platforms',
          match: ['platforms'],
          isActive: (r) => r.name === 'platforms' || (r.name === 'platform' && !shortcutIds.has(r.id)),
        },
        ...platformItems,
        { route: { name: 'tasks' }, label: 'Tasks', icon: 'tasks', match: ['tasks'] },
        { route: { name: 'schedules' }, label: 'Schedules', icon: 'schedules', match: ['schedules'] },
      ],
    },
    { title: 'Accounts', items: [{ route: { name: 'accounts' }, label: 'Accounts', icon: 'accounts', match: ['accounts'] }] },
    {
      title: 'Monitoring',
      items: [
        { route: { name: 'history' }, label: 'Execution History', icon: 'history', match: ['history'] },
        { route: { name: 'notifications' }, label: 'Notifications', icon: 'bell', match: ['notifications'], badge: unread },
      ],
    },
    { title: 'System', items: [{ route: { name: 'settings' }, label: 'Settings', icon: 'settings', match: ['settings'] }] },
  ];

  const online = connection === 'ready' && !!health;

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/80 backdrop-blur">
      <a href="#/dashboard" className="flex items-center gap-3 px-5 pb-5 pt-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
        <Logo size={34} />
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-white">TaskPilot</div>
          <div className="text-[11px] text-slate-500">Personal automation hub</div>
        </div>
      </a>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {sections.map((s, i) => (
          <div key={s.title ?? i}>
            {s.title && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{s.title}</div>}
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const active = item.isActive ? item.isActive(route) : item.match.includes(route.name);
                return (
                  <li key={item.label}>
                    <a
                      href={href(item.route)}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
                        active ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/5 text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                      )}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-indigo-400 to-violet-400" />}
                      {item.platform ? (
                        <span className="flex h-[18px] w-[18px] items-center justify-center [&>span]:scale-[0.8]">
                          <PlatformMark platform={item.platform} size="sm" />
                        </span>
                      ) : (
                        <Icon name={item.icon} size={17} className={active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'} />
                      )}
                      <span className="flex-1">{item.label}</span>
                      {!!item.badge && (
                        <span className="min-w-[20px] rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-semibold leading-5 text-snow">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mx-3 mb-0 mt-2">
        <ThemeToggle compact />
      </div>

      <div className="m-3 rounded-xl border border-white/[0.06] bg-ink-850 p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Service Status</div>
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span className="relative flex h-2.5 w-2.5">
            {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={cx('relative inline-flex h-2.5 w-2.5 rounded-full', online ? 'bg-emerald-400' : connection === 'checking' ? 'bg-slate-500' : 'bg-rose-500')} />
          </span>
          <span className={cx('text-sm font-medium', online ? 'text-emerald-300' : 'text-rose-300')}>
            {online ? 'Connected' : connection === 'checking' ? 'Checking…' : connection === 'unpaired' ? 'Not paired' : 'Offline'}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {online ? `v${health.version} · live ${liveConnected ? 'on' : 'reconnecting'}` : 'Local automation service'}
        </div>
      </div>
    </aside>
  );
}
