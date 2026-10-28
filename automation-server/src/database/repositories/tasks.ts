import type { RunStatus } from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import { bool, json, nowIso, num, str, type Row } from './util.js';

/** Stored part of a task instance; name/description/config come from the adapter at read time. */
export interface TaskRecord {
  id: string;
  platformId: string;
  accountId: string;
  taskType: string;
  /** Instance name of a multi-instance task (null for singleton tasks such as Naukri's). */
  name: string | null;
  enabled: boolean;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastStatus: RunStatus | null;
  lastError: string | null;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

function toTask(r: Row): TaskRecord {
  return {
    id: String(r.id),
    platformId: String(r.platform_id),
    accountId: String(r.account_id),
    taskType: String(r.task_type),
    name: str(r.name),
    enabled: bool(r.enabled),
    lastRunId: str(r.last_run_id),
    lastRunAt: str(r.last_run_at),
    lastStatus: str(r.last_status) as RunStatus | null,
    lastError: str(r.last_error),
    successCount: num(r.success_count),
    failureCount: num(r.failure_count),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class TasksRepository {
  constructor(private readonly db: SqliteDb) {}

  list(filter: { platformId?: string; accountId?: string } = {}): TaskRecord[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.platformId) {
      where.push('platform_id = @platformId');
      params.platformId = filter.platformId;
    }
    if (filter.accountId) {
      where.push('account_id = @accountId');
      params.accountId = filter.accountId;
    }
    const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY platform_id, account_id, created_at, rowid`;
    return (this.db.prepare(sql).all(params) as Row[]).map(toTask);
  }

  get(id: string): TaskRecord | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return r ? toTask(r) : null;
  }

  /** The singleton task of a type for an account. */
  findByType(accountId: string, taskType: string): TaskRecord | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE account_id = ? AND task_type = ? AND name IS NULL').get(accountId, taskType) as Row | undefined;
    return r ? toTask(r) : null;
  }

  /** Create a named instance of a multi-instance task type. */
  insertInstance(t: { id: string; platformId: string; accountId: string; taskType: string; name: string; enabled: boolean }): TaskRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO tasks (id, platform_id, account_id, task_type, name, enabled, created_at, updated_at)
         VALUES (@id, @platformId, @accountId, @taskType, @name, @enabled, @now, @now)`,
      )
      .run({ ...t, enabled: t.enabled ? 1 : 0, now });
    return this.get(t.id)!;
  }

  setName(id: string, name: string) {
    this.db.prepare('UPDATE tasks SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  /** Create missing singleton task instances (idempotent). */
  ensure(rows: Array<{ id: string; platformId: string; accountId: string; taskType: string; enabled: boolean }>) {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO tasks (id, platform_id, account_id, task_type, enabled, created_at, updated_at)
       VALUES (@id, @platformId, @accountId, @taskType, @enabled, @now, @now)`,
    );
    const now = nowIso();
    this.db.transaction(() => rows.forEach((r) => stmt.run({ ...r, enabled: r.enabled ? 1 : 0, now })))();
  }

  setEnabled(id: string, enabled: boolean) {
    this.db.prepare('UPDATE tasks SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, nowIso(), id);
  }

  /** Record the outcome of a finished run on the task (denormalised for fast dashboards). */
  recordResult(id: string, r: { runId: string; at: string; status: RunStatus; error: string | null }) {
    const success = r.status === 'success' || r.status === 'waiting_for_review' ? 1 : 0;
    const failure = r.status === 'failed' || r.status === 'action_required' ? 1 : 0;
    this.db
      .prepare(
        `UPDATE tasks SET last_run_id = @runId, last_run_at = @at, last_status = @status, last_error = @error,
           success_count = success_count + @success, failure_count = failure_count + @failure, updated_at = @at
         WHERE id = @id`,
      )
      .run({ ...r, id, success, failure });
  }

  // --------------------------------------------------------------- task configs
  /**
   * Stored config for one scope:
   *   accountId null            -> platform default
   *   accountId, taskId null    -> that account's override (singleton tasks)
   *   accountId + taskId        -> one task instance (multi-instance tasks)
   */
  getConfig(platformId: string, taskType: string, accountId: string | null, taskId: string | null = null): Record<string, unknown> | null {
    const r = this.db
      .prepare(
        `SELECT config FROM task_configs WHERE platform_id = ? AND task_type = ? AND IFNULL(account_id, '') = ? AND IFNULL(task_id, '') = ?`,
      )
      .get(platformId, taskType, accountId ?? '', taskId ?? '') as Row | undefined;
    return r ? json<Record<string, unknown>>(r.config, {}) : null;
  }

  setConfig(platformId: string, taskType: string, accountId: string | null, config: Record<string, unknown>, taskId: string | null = null) {
    this.db.transaction(() => {
      this.deleteConfig(platformId, taskType, accountId, taskId);
      this.db
        .prepare('INSERT INTO task_configs (platform_id, task_type, account_id, task_id, config, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(platformId, taskType, accountId, taskId, JSON.stringify(config), nowIso());
    })();
  }

  deleteConfig(platformId: string, taskType: string, accountId: string | null, taskId: string | null = null) {
    this.db
      .prepare(`DELETE FROM task_configs WHERE platform_id = ? AND task_type = ? AND IFNULL(account_id, '') = ? AND IFNULL(task_id, '') = ?`)
      .run(platformId, taskType, accountId ?? '', taskId ?? '');
  }
}
