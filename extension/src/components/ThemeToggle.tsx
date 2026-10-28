import { useThemeMode, type ThemeMode } from '../app/theme';
import { Icon, type IconName } from './icons';
import { cx } from '../utils/format';

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: IconName }> = [
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  { mode: 'system', label: 'System', icon: 'monitor' },
];

/** Three-way Light / Dark / System switch. `compact` shows icons only (sidebar). */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useThemeMode();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex w-full rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-inset ring-white/[0.06]">
      {OPTIONS.map((o) => {
        const on = mode === o.mode;
        return (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${o.label} theme`}
            onClick={() => setMode(o.mode)}
            className={cx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
              on ? 'bg-ink-700 text-white shadow-sm ring-1 ring-inset ring-white/10' : 'text-slate-500 hover:text-slate-200',
            )}
          >
            <Icon name={o.icon} size={14} />
            {!compact && o.label}
          </button>
        );
      })}
    </div>
  );
}
