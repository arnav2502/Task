import { describe, expect, it } from 'vitest';
import { computeNextRun, describeSchedule, validateSchedule, type ScheduleShape } from '../../automation-server/src/scheduler/scheduleMath';

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m, 0, 0);
const shape = (s: Partial<ScheduleShape>): ScheduleShape => ({ frequency: 'daily', time: '09:00', daysOfWeek: [], onceDate: null, ...s });
const fixedRng = (v: number) => (lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

describe('computeNextRun', () => {
  it('daily: later today, or tomorrow when the time has passed', () => {
    expect(computeNextRun(shape({}), at(2026, 10, 26, 8, 0))).toEqual(at(2026, 10, 26, 9, 0));
    expect(computeNextRun(shape({}), at(2026, 10, 26, 9, 0))).toEqual(at(2026, 10, 27, 9, 0));
  });

  it('weekly: the next matching weekday', () => {
    // 26 Oct 2026 is a Monday; next Friday (5) is the 30th.
    expect(computeNextRun(shape({ frequency: 'weekly', daysOfWeek: [5], time: '11:00' }), at(2026, 10, 26, 12))).toEqual(at(2026, 10, 30, 11));
  });

  it('specific days: the next of several weekdays, wrapping the week', () => {
    const s = shape({ frequency: 'specific_days', daysOfWeek: [1, 3], time: '10:00' });
    expect(computeNextRun(s, at(2026, 10, 26, 11))).toEqual(at(2026, 10, 28, 10)); // Mon after 10 → Wed
    expect(computeNextRun(s, at(2026, 10, 29, 11))).toEqual(at(2026, 11, 2, 10)); // Thu → next Mon
  });

  it('once: the date if in the future, else null', () => {
    const s = shape({ frequency: 'once', onceDate: '2026-10-27', time: '07:30' });
    expect(computeNextRun(s, at(2026, 10, 26))).toEqual(at(2026, 10, 27, 7, 30));
    expect(computeNextRun(s, at(2026, 10, 28))).toBeNull();
  });

  it('hourly window: every hour from start to end at the fixed minute', () => {
    const s = shape({ frequency: 'hourly', time: '07:15', windowEnd: '09:00', randomMinute: false });
    expect(computeNextRun(s, at(2026, 10, 26, 6))).toEqual(at(2026, 10, 26, 7, 15));
    expect(computeNextRun(s, at(2026, 10, 26, 7, 20))).toEqual(at(2026, 10, 26, 8, 15));
    expect(computeNextRun(s, at(2026, 10, 26, 9, 20))).toEqual(at(2026, 10, 27, 7, 15));
  });

  it('hourly window with random minute: never :00 and always after "from"', () => {
    const s = shape({ frequency: 'hourly', time: '07:00', windowEnd: '23:00', randomMinute: true });
    expect(computeNextRun(s, at(2026, 10, 26, 6, 30), fixedRng(0))).toEqual(at(2026, 10, 26, 7, 1));
    const next = computeNextRun(s, at(2026, 10, 26, 10, 40), fixedRng(5))!;
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBeGreaterThan(40);
    expect(computeNextRun(s, at(2026, 10, 26, 23, 59), fixedRng(30))).toEqual(at(2026, 10, 27, 7, 30));
  });

  it('hourly window limited to some days', () => {
    const s = shape({ frequency: 'hourly', time: '09:00', windowEnd: '10:00', daysOfWeek: [6], randomMinute: false });
    expect(computeNextRun(s, at(2026, 10, 26, 8))).toEqual(at(2026, 10, 31, 9));
  });
});

describe('validateSchedule', () => {
  it('accepts valid schedules', () => {
    expect(validateSchedule(shape({}))).toBeNull();
    expect(validateSchedule(shape({ frequency: 'hourly', time: '07:00', windowEnd: '23:00' }))).toBeNull();
  });
  it.each([
    [shape({ time: '25:00' }), /Invalid time/],
    [shape({ frequency: 'weekly', daysOfWeek: [1, 2] }), /exactly one day/],
    [shape({ frequency: 'specific_days', daysOfWeek: [] }), /at least one day/],
    [shape({ frequency: 'once', onceDate: null }), /need a date/],
    [shape({ frequency: 'hourly', windowEnd: null }), /end time/],
    [shape({ frequency: 'hourly', time: '10:00', windowEnd: '08:00' }), /end after/],
  ])('rejects %#', (s, msg) => {
    expect(validateSchedule(s)).toMatch(msg);
  });
});

describe('describeSchedule', () => {
  it('produces readable summaries', () => {
    expect(describeSchedule(shape({}))).toBe('Daily at 9:00 AM');
    expect(describeSchedule(shape({ frequency: 'specific_days', daysOfWeek: [1, 2, 3, 4, 5], time: '10:00' }))).toBe('Mon, Tue, Wed, Thu, Fri at 10:00 AM');
    expect(describeSchedule(shape({ frequency: 'hourly', time: '07:00', windowEnd: '23:00', randomMinute: true }))).toBe('Hourly 7 AM–11 PM daily, random minute');
  });
});
