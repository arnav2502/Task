import { DAY_NAMES } from '@shared/constants/index.js';
import type { Schedule } from '@shared/types/index.js';

export type ScheduleShape = Pick<Schedule, 'frequency' | 'time' | 'daysOfWeek' | 'onceDate'> & Partial<Pick<Schedule, 'windowEnd' | 'randomMinute'>>;

/** Random integer in [lo, hi]. Injectable for deterministic tests. */
export type Rng = (lo: number, hi: number) => number;
export const defaultRng: Rng = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function parseTime(time: string): { h: number; m: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) throw new Error(`Invalid time "${time}" — expected HH:mm (24 h)`);
  return { h: Number(match[1]), m: Number(match[2]) };
}

export const formatTime = (time: string) => {
  const { h, m } = parseTime(time);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Validate a schedule definition; returns a readable error or null. */
export function validateSchedule(s: ScheduleShape): string | null {
  try {
    parseTime(s.time);
  } catch (e) {
    return (e as Error).message;
  }
  const days = s.daysOfWeek ?? [];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Days must be 0 (Sun) … 6 (Sat)';
  if (s.frequency === 'weekly' && days.length !== 1) return 'Weekly schedules need exactly one day';
  if (s.frequency === 'specific_days' && days.length === 0) return 'Pick at least one day';
  if (s.frequency === 'once' && (!s.onceDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.onceDate))) return 'One-time schedules need a date (YYYY-MM-DD)';
  if (s.frequency === 'hourly') {
    if (!s.windowEnd) return 'Hourly schedules need an end time';
    try {
      if (parseTime(s.windowEnd).h < parseTime(s.time).h) return 'The window must end after it starts';
    } catch (e) {
      return (e as Error).message;
    }
  }
  return null;
}

/** Next occurrence strictly after `from`, in local time. Null when a one-time schedule is in the past. */
export function computeNextRun(s: ScheduleShape, from: Date = new Date(), rng: Rng = defaultRng): Date | null {
  const { h, m } = parseTime(s.time);
  if (s.frequency === 'hourly') return nextHourlyRun(s, from, rng);
  if (s.frequency === 'once') {
    if (!s.onceDate) return null;
    const [y, mo, d] = s.onceDate.split('-').map(Number) as [number, number, number];
    const at = new Date(y, mo - 1, d, h, m, 0, 0);
    return at.getTime() > from.getTime() ? at : null;
  }
  const allowed = s.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : s.frequency === 'weekly' ? s.daysOfWeek.slice(0, 1) : s.daysOfWeek;
  if (!allowed.length) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const c = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, h, m, 0, 0);
    if (c.getTime() > from.getTime() && allowed.includes(c.getDay())) return c;
  }
  return null;
}

/**
 * Hourly window: one run in every hour from `time` to `windowEnd`; the end hour is inclusive (07:00–23:00
 * = 17 runs, the last one during the 23:00 hour). With randomMinute each
 * run gets a fresh random minute 1–59 (never :00), so the pattern changes every hour and every day.
 * Empty daysOfWeek = every day.
 */
function nextHourlyRun(s: ScheduleShape, from: Date, rng: Rng): Date | null {
  const start = parseTime(s.time);
  const end = parseTime(s.windowEnd ?? s.time);
  const days = s.daysOfWeek.length ? s.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (!days.includes(day.getDay())) continue;
    for (let hour = start.h; hour <= end.h; hour++) {
      const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
      const sameHour = slotStart.getTime() <= from.getTime();
      if (s.randomMinute) {
        if (sameHour && slotStart.getTime() + 3_600_000 <= from.getTime()) continue;
        // Never before the window's start minute (09:30 start → first run at 09:30 or later).
        const startMin = hour === start.h ? start.m : 1;
        const lo = Math.max(startMin, sameHour ? from.getMinutes() + 1 : 1);
        if (lo > 59) continue;
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, rng(Math.max(1, lo), 59), 0, 0);
      }
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, start.m, 0, 0);
      if (at.getTime() > from.getTime()) return at;
    }
  }
  return null;
}

export function describeSchedule(s: ScheduleShape): string {
  const { h, m } = parseTime(s.time);
  const t = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayList = (d: number[]) => d.map((x) => DAY_NAMES[x]).join(', ');
  switch (s.frequency) {
    case 'once':
      return `Once on ${s.onceDate} at ${t}`;
    case 'daily':
      return `Daily at ${t}`;
    case 'weekly':
      return `Every ${DAY_NAMES[s.daysOfWeek[0] ?? 0]} at ${t}`;
    case 'specific_days':
      return `${dayList(s.daysOfWeek)} at ${t}`;
    case 'hourly': {
      const e = parseTime(s.windowEnd ?? s.time);
      const hr = (x: number) => new Date(2000, 0, 1, x).toLocaleTimeString('en-US', { hour: 'numeric' });
      const days = s.daysOfWeek.length && s.daysOfWeek.length < 7 ? ` (${dayList(s.daysOfWeek)})` : ' daily';
      return `Hourly ${hr(h)}–${hr(e.h)}${days}${s.randomMinute ? ', random minute' : `, at :${String(m).padStart(2, '0')}`}`;
    }
  }
}
