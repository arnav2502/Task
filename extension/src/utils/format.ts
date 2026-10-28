import { DAY_NAMES, SYSTEM_TASK_LABELS } from '@shared/constants/index';
import type { RunTrigger } from '@shared/types/index';

const LOCALE = 'en-IN';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

/** "in 5 min", "3 h ago", "yesterday" … */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => (diff >= 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (abs < 45_000) return diff >= 0 ? 'in a moment' : 'just now';
  if (abs < 3_600_000) return fmt(Math.round(abs / 60_000), 'min');
  if (abs < 86_400_000) return fmt(Math.round(abs / 3_600_000), 'h');
  const days = Math.round(abs / 86_400_000);
  if (days === 1) return diff >= 0 ? 'tomorrow' : 'yesterday';
  if (days < 14) return fmt(days, 'days');
  return formatDate(iso);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const TRIGGER_LABEL: Record<RunTrigger, string> = {
  manual: 'Manual',
  schedule: 'Scheduled',
  missed: 'Missed',
  retry: 'Retry',
};

export function taskLabel(taskType: string, taskName?: string | null): string {
  return taskName || SYSTEM_TASK_LABELS[taskType] || taskType;
}

export const dayName = (d: number) => DAY_NAMES[d] ?? String(d);

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
