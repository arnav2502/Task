import type { ScheduleFrequency, ScheduleMode } from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import { bool, json, nowIso, str, type Row } from './util.js';

export interface ScheduleRecord {
  id: string;
  platformId: string;
  accountId: string;
  taskId: string;
  taskType: string;
  frequency: ScheduleFrequency;
  time: string;
  daysOfWeek: number[];
  onceDate: string | null;
  windowEnd: string | null;
  randomMinute: boolean;
  mode: ScheduleMode;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSchedule(r: Row): ScheduleRecord {
  return {
    id: String(r.id),
    platformId: String(r.platform_id),
    accountId: String(r.account_id),
    taskId: String(r.task_id),
    taskType: String(r.task_type),
    frequency: r.frequency as ScheduleFrequency,
    time: String(r.time),
    daysOfWeek: json<number[]>(r.days_of_week, []),
    onceDate: str(r.once_date),
    windowEnd: str(r.window_end),
    randomMinute: bool(r.random_minute),
    mode: r.mode as ScheduleMode,
    enabled: bool(r.enabled),
    nextRunAt: str(r.next_run_at),
    lastRunAt: str(r.last_run_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class SchedulesRepository {
  constructor(private readonly db: SqliteDb) {}

  list(filter: { platformId?: string; accountId?: string; taskId?: string } = {}): ScheduleRecord[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    for (const [key, col] of [
      ['platformId', 'platform_id'],
      ['accountId', 'account_id'],
      ['taskId', 'task_id'],
    ] as const) {
      const v = filter[key];
      if (v) {
        where.push(`${col} = @${key}`);
        params[key] = v;
      }
    }
    const sql = `SELECT * FROM schedules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`;
    return (this.db.prepare(sql).all(params) as Row[]).map(toSchedule);
  }

  get(id: string): ScheduleRecord | null {
    const r = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
    return r ? toSchedule(r) : null;
  }

  upsert(s: Omit<ScheduleRecord, 'createdAt' | 'updatedAt'>): ScheduleRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO schedules (id, platform_id, account_id, task_id, task_type, frequency, time, days_of_week, once_date, window_end,
           random_minute, mode, enabled, next_run_at, last_run_at, created_at, updated_at)
         VALUES (@id, @platformId, @accountId, @taskId, @taskType, @frequency, @time, @daysOfWeek, @onceDate, @windowEnd,
           @randomMinute, @mode, @enabled, @nextRunAt, @lastRunAt, @now, @now)
         ON CONFLICT(id) DO UPDATE SET frequency = excluded.frequency, time = excluded.time, days_of_week = excluded.days_of_week,
           once_date = excluded.once_date, window_end = excluded.window_end, random_minute = excluded.random_minute,
           mode = excluded.mode, enabled = excluded.enabled, next_run_at = excluded.next_run_at, last_run_at = excluded.last_run_at,
           updated_at = excluded.updated_at`,
      )
      .run({
        ...s,
        daysOfWeek: JSON.stringify(s.daysOfWeek),
        randomMinute: s.randomMinute ? 1 : 0,
        enabled: s.enabled ? 1 : 0,
        now,
      });
    return this.get(s.id)!;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
  }
}
