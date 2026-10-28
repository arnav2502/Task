import type { SharedJob, SharedJobStatus } from '@shared/types/naukri.js';
import type { Migration, SqliteDb } from '../../database/database.js';

/** Naukri-owned tables. They cascade with the account, and log retention never touches them. */
export const NAUKRI_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'naukri shared jobs + profile state',
    up: `
    -- Every Share Interest attempt. Kept permanently: it is what prevents applying to a role twice
    -- (Naukri's listing does not mark roles you already shared).
    CREATE TABLE naukri_shared_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT,
      experience TEXT,
      salary TEXT,
      location TEXT,
      status TEXT NOT NULL,
      message TEXT,
      run_id TEXT,
      shared_at TEXT NOT NULL
    );
    CREATE INDEX idx_naukri_shared_account ON naukri_shared_jobs(account_id, job_id);
    CREATE INDEX idx_naukri_shared_time ON naukri_shared_jobs(account_id, shared_at);

    -- Resume-headline baseline: the headline without the update marker, learned after the first run.
    CREATE TABLE naukri_profile_state (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      marker_baseline TEXT,
      updated_at TEXT NOT NULL
    );`,
  },
];

export interface RoleRecord {
  jobId: string;
  title: string;
  company: string | null;
  experience: string | null;
  salary: string | null;
  location: string | null;
}

export class NaukriStore {
  constructor(private readonly db: SqliteDb) {}

  /** Job ids that were successfully shared (failed attempts may be retried by a later run). */
  sharedJobIds(accountId: string): Set<string> {
    const rows = this.db.prepare(`SELECT DISTINCT job_id FROM naukri_shared_jobs WHERE account_id = ? AND status = 'shared'`).all(accountId) as Array<{
      job_id: string;
    }>;
    return new Set(rows.map((r) => r.job_id));
  }

  /**
   * Job ids that must not be tried again: shared, failed once (likely needs manual answers), or
   * pending — clicked but never confirmed, so the application may have gone through.
   */
  attemptedJobIds(accountId: string): Set<string> {
    const rows = this.db.prepare(`SELECT DISTINCT job_id FROM naukri_shared_jobs WHERE account_id = ? AND status IN ('pending', 'shared', 'failed')`).all(accountId) as Array<{
      job_id: string;
    }>;
    return new Set(rows.map((r) => r.job_id));
  }

  countSharedSince(accountId: string | null, sinceIso: string): number {
    const row = (
      accountId
        ? this.db.prepare(`SELECT COUNT(*) AS n FROM naukri_shared_jobs WHERE account_id = ? AND status = 'shared' AND shared_at >= ?`).get(accountId, sinceIso)
        : this.db.prepare(`SELECT COUNT(*) AS n FROM naukri_shared_jobs WHERE status = 'shared' AND shared_at >= ?`).get(sinceIso)
    ) as { n: number };
    return row.n;
  }

  sharedTodayByAccount(sinceIso: string): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT account_id, COUNT(*) AS n FROM naukri_shared_jobs WHERE status = 'shared' AND shared_at >= ? GROUP BY account_id`)
      .all(sinceIso) as Array<{ account_id: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.account_id, r.n]));
  }

  record(accountId: string, role: RoleRecord, status: SharedJobStatus, message: string | null, runId: string | null): number {
    const info = this.db
      .prepare(
        `INSERT INTO naukri_shared_jobs (account_id, job_id, title, company, experience, salary, location, status, message, run_id, shared_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(accountId, role.jobId, role.title, role.company, role.experience, role.salary, role.location, status, message, runId, new Date().toISOString());
    return Number(info.lastInsertRowid);
  }

  /** Settle a pending attempt with its outcome. */
  settle(id: number, status: SharedJobStatus, message: string | null) {
    this.db.prepare('UPDATE naukri_shared_jobs SET status = ?, message = ?, shared_at = ? WHERE id = ?').run(status, message, new Date().toISOString(), id);
  }

  list(accountId: string | null, limit: number): SharedJob[] {
    const rows = (
      accountId
        ? this.db.prepare('SELECT * FROM naukri_shared_jobs WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, limit)
        : this.db.prepare('SELECT * FROM naukri_shared_jobs ORDER BY id DESC LIMIT ?').all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      accountId: String(r.account_id),
      jobId: String(r.job_id),
      title: String(r.title),
      company: (r.company as string | null) ?? null,
      experience: (r.experience as string | null) ?? null,
      salary: (r.salary as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      status: r.status as SharedJobStatus,
      message: (r.message as string | null) ?? null,
      runId: (r.run_id as string | null) ?? null,
      sharedAt: String(r.shared_at),
    }));
  }

  markerBaseline(accountId: string): string | null {
    const r = this.db.prepare('SELECT marker_baseline FROM naukri_profile_state WHERE account_id = ?').get(accountId) as { marker_baseline: string | null } | undefined;
    return r?.marker_baseline ?? null;
  }

  setMarkerBaseline(accountId: string, baseline: string | null) {
    this.db
      .prepare(
        `INSERT INTO naukri_profile_state (account_id, marker_baseline, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET marker_baseline = excluded.marker_baseline, updated_at = excluded.updated_at`,
      )
      .run(accountId, baseline, new Date().toISOString());
  }
}
