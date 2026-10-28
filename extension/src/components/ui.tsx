/** Small UI kit: buttons, cards, inputs, modal, drawer, tabs, skeletons … (Tailwind, dark theme). */
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';
import { cx } from '../utils/format';

// ------------------------------------------------------------------ buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-indigo-500 to-violet-500 text-snow shadow-[0_8px_20px_-8px_rgba(99,102,241,0.7)] hover:from-indigo-400 hover:to-violet-400 disabled:opacity-40 disabled:shadow-none disabled:hover:from-indigo-500 disabled:hover:to-violet-500',
  secondary: 'bg-ink-700 text-slate-100 ring-1 ring-inset ring-white/10 hover:bg-ink-600 disabled:opacity-50',
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40',
  subtle: 'bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-40',
  danger: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25 disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: IconName; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        VARIANT[variant],
        className,
      )}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:opacity-40',
        className,
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// -------------------------------------------------------------------- cards
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-xl border border-white/[0.06] bg-ink-800/80 shadow-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: ReactNode; subtitle?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-indigo-300/80">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- badges
export type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'indigo' | 'violet' | 'cyan';

const TONE: Record<Tone, string> = {
  slate: 'bg-slate-500/10 text-slate-300 ring-slate-400/20',
  green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/25',
  red: 'bg-rose-500/10 text-rose-300 ring-rose-400/25',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-400/25',
  blue: 'bg-sky-500/10 text-sky-300 ring-sky-400/25',
  indigo: 'bg-indigo-500/10 text-indigo-300 ring-indigo-400/25',
  violet: 'bg-violet-500/10 text-violet-300 ring-violet-400/25',
  cyan: 'bg-cyan-500/10 text-cyan-300 ring-cyan-400/25',
};

const DOT: Record<Tone, string> = {
  slate: 'bg-slate-400',
  green: 'bg-emerald-400',
  red: 'bg-rose-400',
  amber: 'bg-amber-400',
  blue: 'bg-sky-400',
  indigo: 'bg-indigo-400',
  violet: 'bg-violet-400',
  cyan: 'bg-cyan-400',
};

export function Badge({ tone = 'slate', dot, pulse, children, className }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', TONE[tone], className)}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && <span className={cx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', DOT[tone])} />}
          <span className={cx('relative inline-flex h-1.5 w-1.5 rounded-full', DOT[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------- inputs
const FIELD = 'w-full rounded-lg border border-white/10 bg-ink-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(FIELD, 'h-9', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(FIELD, 'h-9 pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-300">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-rose-300">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
        checked ? 'bg-gradient-to-r from-indigo-500 to-violet-500' : 'bg-ink-600',
      )}
    >
      <span
        className={cx(
          'inline-block rounded-full bg-snow shadow transition',
          size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
          checked ? (size === 'sm' ? 'translate-x-[18px]' : 'translate-x-[22px]') : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-900/80 p-1 ring-1 ring-inset ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
            value === o.value ? 'bg-indigo-500/20 text-white ring-1 ring-inset ring-indigo-400/40' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft('');
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-2 py-1.5 focus-within:border-indigo-400/60 focus-within:ring-2 focus-within:ring-indigo-500/25">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-200">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="text-indigo-300/70 hover:text-white" onClick={() => onChange(value.filter((x) => x !== t))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[120px] flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
      />
    </div>
  );
}

// ----------------------------------------------------------- modal / drawer
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

function useFocusFirst(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    el?.focus();
  }, [ref]);
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscape(onClose);
  useFocusFirst(ref);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('w-full animate-pop-in rounded-2xl border border-white/10 bg-ink-800 shadow-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-white">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <IconButton icon="x" label="Close" data-close onClick={onClose} />
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-[2px] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={label} className="flex h-full w-full max-w-3xl animate-slide-in flex-col border-l border-white/10 bg-ink-850 shadow-2xl">
        {children}
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------- tabs etc.
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: string; icon?: IconName; badge?: ReactNode }> }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-white/[0.06]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:bg-white/5',
            value === t.value ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
          )}
        >
          {t.icon && <Icon name={t.icon} size={15} />}
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-white/[0.05]', className)} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, description, action }: { icon?: IconName; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/10">
        <Icon name={icon} size={22} />
      </span>
      <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <span className="flex items-center gap-2">
        <Icon name="alert" size={16} />
        {message}
      </span>
      {onRetry && (
        <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Callout({ tone = 'amber', icon = 'alert', title, children }: { tone?: 'amber' | 'indigo' | 'rose'; icon?: IconName; title?: ReactNode; children: ReactNode }) {
  const cls = {
    amber: 'border-amber-400/25 bg-amber-500/[0.07] text-amber-100',
    indigo: 'border-indigo-400/25 bg-indigo-500/[0.07] text-indigo-100',
    rose: 'border-rose-400/25 bg-rose-500/[0.07] text-rose-100',
  }[tone];
  return (
    <div className={cx('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls)}>
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 opacity-80" />
      <div>
        {title && <div className="font-semibold">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
