import type {
  BrowserMode,
  ExecutionRun,
  LogLevel,
  RunFilters,
  RunLogLine,
  RunStage,
  RunStatus,
  RunTrigger,
} from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import { json, nowIso, num, setClause, str, type Row } from './util.js';

/** Internal run record: adds file paths that are never sent to the extension. */
export interface RunRecord extends ExecutionRun {
  screenshotPath: string | null;
  logPath: string | null;
  payload: Record<string, unknown> | null;
}

export interface NewRun {
  platformId: string;
  accountId: string;
  accountName: string;
  taskId: string | null;
  taskType: string;
  taskName: string;
  scheduleId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  mode: BrowserMode;
  priority: number;
  maxAttempts: number;
  retryOf?: string | null;
  resultMessage?: string | null;
  /** Input of a user-confirmed adapter action (never sent to the extension). */
  payload?: Record<string, unknown> | null;
}

export type RunPatch = Partial<
  Pick<
    RunRecord,
    | 'status'
    | 'stage'
    | 'currentStep'
    | 'attempt'
    | 'maxAttempts'
    | 'startedAt'
    | 'completedAt'
    | 'errorCode'
    | 'error'
    | 'resultMessage'
    | 'result'
    | 'screenshotPath'
    | 'logPath'
    | 'reviewCount'
  >
>;

const COLUMNS: Record<keyof RunPatch, string> = {
  status: 'status',
  stage: 'stage',
  currentStep: 'current_step',
  attempt: 'attempt',
  maxAttempts: 'max_attempts',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  errorCode: 'error_code',
  error: 'error',
  resultMessage: 'result_message',
  result: 'result',
  screenshotPath: 'screenshot_path',
  logPath: 'log_path',
  reviewCount: 'review_count',
};

function toRun(r: Row): RunRecord {
  const startedAt = str(r.started_at);
  const completedAt = str(r.completed_at);
  return {
    id: String(r.id),
    platformId: String(r.platform_id),
    accountId: String(r.account_id),
    accountName: String(r.account_name),
    taskId: str(r.task_id),
    taskType: String(r.task_type),
    taskName: String(r.task_name),
    scheduleId: str(r.schedule_id),
    trigger: r.trigger as RunTrigger,
    status: r.status as RunStatus,
    mode: r.mode as BrowserMode,
    priority: num(r.priority),
    stage: str(r.stage) as RunStage | null,
    currentStep: str(r.current_step),
    attempt: num(r.attempt),
    maxAttempts: num(r.max_attempts),
    queuedAt: String(r.queued_at),
    startedAt,
    completedAt,
    durationMs: startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null,
    errorCode: str(r.error_code),
    error: str(r.error),
    resultMessage: str(r.result_message),
    result: json<Record<string, unknown> | null>(r.result, null),
    hasScreenshot: !!r.screenshot_path,
    retryOf: str(r.retry_of),
    reviewCount: num(r.review_count),
    screenshotPath: str(r.screenshot_path),
    logPath: str(r.log_path),
    payload: json<Record<string, unknown> | null>(r.payload, null),
  };
}

/** RUN-YYYYMMDD-NNNNNN (local date, global sequence). */
export function formatRunId(seq: number, d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `RUN-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(seq, 6)}`;
}

export class RunsRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(run: NewRun): RunRecord {
    return this.db.transaction(() => {
      const last = this.db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'execution_runs'`).get() as { seq: number } | undefined;
      const seq = (last?.seq ?? 0) + 1;
      const id = formatRunId(seq);
      this.db
        .prepare(
          `INSERT INTO execution_runs (seq, id, platform_id, account_id, account_name, task_id, task_type, task_name, schedule_id,
             trigger, status, mode, priority, max_attempts, queued_at, retry_of, result_message, completed_at, payload)
           VALUES (@seq, @id, @platformId, @accountId, @accountName, @taskId, @taskType, @taskName, @scheduleId,
             @trigger, @status, @mode, @priority, @maxAttempts, @now, @retryOf, @resultMessage, @completedAt, @payload)`,
        )
        .run({
          ...run,
          seq,
          id,
          now: nowIso(),
          retryOf: run.retryOf ?? null,
          resultMessage: run.resultMessage ?? null,
          completedAt: run.status === 'skipped' ? nowIso() : null,
          payload: run.payload ? JSON.stringify(run.payload) : null,
        });
      return this.get(id)!;
    })();
  }

  get(id: string): RunRecord | null {
    const r = this.db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? toRun(r) : null;
  }

  update(id: string, patch: RunPatch): RunRecord | null {
    const { sql, params } = setClause(patch as Record<string, unknown>, COLUMNS);
    if (sql) this.db.prepare(`UPDATE execution_runs SET ${sql} WHERE id = @id`).run({ ...params, id });
    return this.get(id);
  }

  list(f: RunFilters = {}): { runs: RunRecord[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    const eq: Array<[keyof RunFilters, string]> = [
      ['platformId', 'platform_id'],
      ['accountId', 'account_id'],
      ['taskType', 'task_type'],
      ['taskId', 'task_id'],
      ['status', 'status'],
      ['trigger', 'trigger'],
    ];
    for (const [key, col] of eq) {
      if (f[key] !== undefined) {
        where.push(`${col} = @${key}`);
        params[key] = f[key];
      }
    }
    if (f.from) {
      where.push('queued_at >= @from');
      params.from = new Date(f.from).toISOString();
    }
    if (f.to) {
      where.push('queued_at <= @to');
      params.to = new Date(f.to).toISOString();
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM execution_runs ${clause}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM execution_runs ${clause} ORDER BY seq DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: f.limit ?? 50, offset: f.offset ?? 0 }) as Row[];
    return { runs: rows.map(toRun), total };
  }

  active(): RunRecord[] {
    return (this.db.prepare(`SELECT * FROM execution_runs WHERE status IN ('queued', 'running') ORDER BY seq`).all() as Row[]).map(toRun);
  }

  /** Runs left queued/running by a previous process can never finish. */
  cancelOrphaned(): number {
    return this.db
      .prepare(
        `UPDATE execution_runs SET status = 'cancelled', error = 'The service stopped before this run finished', error_code = 'CANCELLED',
           completed_at = @now, current_step = NULL
         WHERE status IN ('queued', 'running')`,
      )
      .run({ now: nowIso() }).changes;
  }

  /** Counts per status since a timestamp, optionally per platform. */
  countsSince(since: string, platformId?: string): Record<RunStatus | 'total', number> {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM execution_runs WHERE queued_at >= @since ${platformId ? 'AND platform_id = @platformId' : ''}
         AND task_id IS NOT NULL GROUP BY status`,
      )
      .all({ since, platformId }) as Array<{ status: RunStatus; n: number }>;
    const out = { total: 0, queued: 0, running: 0, success: 0, waiting_for_review: 0, failed: 0, action_required: 0, cancelled: 0, skipped: 0 };
    for (const r of rows) {
      out[r.status] = r.n;
      out.total += r.n;
    }
    return out;
  }

  /** Successful runs per task type since a timestamp (dashboard metrics). */
  successByTaskType(platformId: string, since: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT task_type, COUNT(*) AS n FROM execution_runs
         WHERE platform_id = ? AND status IN ('success', 'waiting_for_review') AND queued_at >= ? GROUP BY task_type`,
      )
      .all(platformId, since) as Array<{ task_type: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.task_type, r.n]));
  }

  lastRunAt(platformId: string): string | null {
    const r = this.db
      .prepare(`SELECT MAX(COALESCE(started_at, queued_at)) AS at FROM execution_runs WHERE platform_id = ? AND status NOT IN ('queued', 'skipped')`)
      .get(platformId) as { at: string | null };
    return r.at;
  }

  // ------------------------------------------------------------------ run logs
  appendLog(runId: string, level: LogLevel, stage: RunStage | null, message: string, ts = nowIso()): RunLogLine {
    const info = this.db.prepare('INSERT INTO run_logs (run_id, ts, level, stage, message) VALUES (?, ?, ?, ?, ?)').run(runId, ts, level, stage, message);
    return { id: Number(info.lastInsertRowid), runId, ts, level, stage, message };
  }

  logs(runId: string): RunLogLine[] {
    return (this.db.prepare('SELECT * FROM run_logs WHERE run_id = ? ORDER BY id').all(runId) as Row[]).map((r) => ({
      id: num(r.id),
      runId: String(r.run_id),
      ts: String(r.ts),
      level: r.level as LogLevel,
      stage: str(r.stage) as RunStage | null,
      message: String(r.message),
    }));
  }

  // ----------------------------------------------------------------- retention
  /** Finished runs older than the cutoff (their logs cascade). Returns the deleted runs' file paths. */
  deleteFinishedBefore(cutoff: string): { count: number; files: string[] } {
    const rows = this.db
      .prepare(`SELECT screenshot_path, log_path FROM execution_runs WHERE queued_at < ? AND status NOT IN ('queued', 'running')`)
      .all(cutoff) as Row[];
    const count = this.db.prepare(`DELETE FROM execution_runs WHERE queued_at < ? AND status NOT IN ('queued', 'running')`).run(cutoff).changes;
    const files = rows.flatMap((r) => [str(r.screenshot_path), str(r.log_path)]).filter((x): x is string => !!x);
    return { count, files };
  }

  /** Files referenced by runs that are still kept (never deleted by the file sweep). */
  referencedFiles(): string[] {
    const rows = this.db.prepare('SELECT screenshot_path, log_path FROM execution_runs').all() as Row[];
    return rows.flatMap((r) => [str(r.screenshot_path), str(r.log_path)]).filter((x): x is string => !!x);
  }
}
