import type {
  ConnectionDegree,
  ConnectionDegreeFilter,
  ConnectionDraft,
  DraftStatus,
  Lead,
  LeadStatus,
  LinkedInSearch,
  LinkedInStats,
  LinkedInTaskStats,
} from '@shared/types/linkedin.js';
import type { Migration, SqliteDb } from '../../database/database.js';

/** LinkedIn-owned tables (scope "linkedin"). Generic tables are never extended for LinkedIn data. */
export const LINKEDIN_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'linkedin leads, searches, task stats, lead actions, connection drafts',
    up: `
    -- One row per person per LinkedIn account. profile_reference (the /in/<slug> path) is the identity,
    -- so a lead found again is updated instead of shown as new.
    CREATE TABLE linkedin_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      profile_reference TEXT NOT NULL,
      profile_url TEXT NOT NULL,
      name TEXT NOT NULL,
      headline TEXT,
      job_title TEXT,
      company TEXT,
      location TEXT,
      connection_degree TEXT,
      status TEXT NOT NULL DEFAULT 'NEW',
      last_error TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (account_id, profile_reference)
    );
    CREATE INDEX idx_linkedin_leads_status ON linkedin_leads(account_id, status);
    CREATE INDEX idx_linkedin_leads_seen ON linkedin_leads(first_seen_at);

    -- Every executed search (one per Lead Finder run) with its outcome.
    CREATE TABLE linkedin_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT,
      keywords TEXT NOT NULL,
      location TEXT,
      company TEXT,
      job_titles TEXT NOT NULL DEFAULT '[]',
      industry TEXT,
      connection_degree TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      results_read INTEGER NOT NULL DEFAULT 0,
      matched INTEGER NOT NULL DEFAULT 0,
      new_leads INTEGER NOT NULL DEFAULT 0,
      candidates INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_linkedin_searches_task ON linkedin_searches(task_id, id);

    -- LinkedIn view of a generic Lead Finder task, and which leads each task found.
    CREATE TABLE linkedin_tasks (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      last_search_id INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE linkedin_task_leads (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      lead_id INTEGER NOT NULL REFERENCES linkedin_leads(id) ON DELETE CASCADE,
      found_at TEXT NOT NULL,
      PRIMARY KEY (task_id, lead_id)
    );

    -- Audit trail of everything that happened to a lead (found, reviewed, skipped, confirmed, sent …).
    CREATE TABLE linkedin_lead_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES linkedin_leads(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      detail TEXT,
      run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_linkedin_lead_actions_lead ON linkedin_lead_actions(lead_id, id);

    -- Connection requests prepared for review. At most one active (pending/confirmed) draft per lead.
    CREATE TABLE linkedin_connection_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES linkedin_leads(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      run_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX ux_linkedin_drafts_active ON linkedin_connection_drafts(lead_id) WHERE status IN ('pending', 'confirmed');
    CREATE INDEX idx_linkedin_drafts_status ON linkedin_connection_drafts(status, task_id);`,
  },
];

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface LeadCard {
  profileReference: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  connectionDegree: ConnectionDegree;
}

function toLead(r: Row): Lead {
  return {
    id: Number(r.id),
    accountId: String(r.account_id),
    taskId: s(r.task_id),
    profileReference: String(r.profile_reference),
    profileUrl: String(r.profile_url),
    name: String(r.name),
    headline: s(r.headline),
    jobTitle: s(r.job_title),
    company: s(r.company),
    location: s(r.location),
    connectionDegree: s(r.connection_degree) as ConnectionDegree,
    status: r.status as LeadStatus,
    lastError: s(r.last_error),
    firstSeenAt: String(r.first_seen_at),
    lastSeenAt: String(r.last_seen_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toSearch(r: Row): LinkedInSearch {
  return {
    id: Number(r.id),
    taskId: String(r.task_id),
    runId: s(r.run_id),
    keywords: String(r.keywords),
    location: s(r.location),
    company: s(r.company),
    jobTitles: JSON.parse(String(r.job_titles ?? '[]')) as string[],
    industry: s(r.industry),
    connectionDegree: r.connection_degree as ConnectionDegreeFilter,
    filters: JSON.parse(String(r.filters_json ?? '{}')) as Record<string, unknown>,
    resultsRead: Number(r.results_read),
    matched: Number(r.matched),
    newLeads: Number(r.new_leads),
    candidates: Number(r.candidates),
    createdAt: String(r.created_at),
  };
}

/** Statuses from which a lead may (again) become a connection candidate. */
export const CANDIDATE_STATUSES: LeadStatus[] = ['NEW', 'REVIEWED', 'SELECTED'];

export class LinkedInStore {
  constructor(private readonly db: SqliteDb) {}

  // -------------------------------------------------------------------- leads
  /** Insert a new lead or refresh a known one (status untouched). Duplicate protection lives here. */
  upsertLead(accountId: string, taskId: string | null, card: LeadCard, runId: string | null): { lead: Lead; isNew: boolean } {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM linkedin_leads WHERE account_id = ? AND profile_reference = ?').get(accountId, card.profileReference) as
        | Row
        | undefined;
      const t = now();
      if (existing) {
        this.db
          .prepare(
            `UPDATE linkedin_leads SET name = ?, headline = COALESCE(?, headline), job_title = COALESCE(?, job_title), company = COALESCE(?, company),
               location = COALESCE(?, location), connection_degree = COALESCE(?, connection_degree), task_id = COALESCE(?, task_id),
               last_seen_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(card.name, card.headline, card.jobTitle, card.company, card.location, card.connectionDegree, taskId, t, t, existing.id);
        if (taskId) this.linkTask(taskId, Number(existing.id));
        return { lead: this.lead(Number(existing.id))!, isNew: false };
      }
      const info = this.db
        .prepare(
          `INSERT INTO linkedin_leads (account_id, task_id, profile_reference, profile_url, name, headline, job_title, company, location,
             connection_degree, status, first_seen_at, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)`,
        )
        .run(accountId, taskId, card.profileReference, card.profileUrl, card.name, card.headline, card.jobTitle, card.company, card.location, card.connectionDegree, t, t, t, t);
      const id = Number(info.lastInsertRowid);
      if (taskId) this.linkTask(taskId, id);
      this.logAction(id, 'FOUND', taskId ? 'Found by a Lead Finder search' : null, runId);
      return { lead: this.lead(id)!, isNew: true };
    })();
  }

  private linkTask(taskId: string, leadId: number) {
    this.db.prepare('INSERT OR IGNORE INTO linkedin_task_leads (task_id, lead_id, found_at) VALUES (?, ?, ?)').run(taskId, leadId, now());
  }

  lead(id: number): Lead | null {
    const r = this.db.prepare('SELECT * FROM linkedin_leads WHERE id = ?').get(id) as Row | undefined;
    return r ? toLead(r) : null;
  }

  setStatus(id: number, status: LeadStatus, action: string, detail: string | null = null, runId: string | null = null, error: string | null = null): Lead {
    this.db.prepare('UPDATE linkedin_leads SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(status, error, now(), id);
    this.logAction(id, action, detail, runId);
    return this.lead(id)!;
  }

  logAction(leadId: number, action: string, detail: string | null, runId: string | null) {
    this.db.prepare('INSERT INTO linkedin_lead_actions (lead_id, action, detail, run_id, created_at) VALUES (?, ?, ?, ?, ?)').run(leadId, action, detail, runId, now());
  }

  actions(leadId: number): Array<{ action: string; detail: string | null; runId: string | null; createdAt: string }> {
    return (this.db.prepare('SELECT * FROM linkedin_lead_actions WHERE lead_id = ? ORDER BY id DESC LIMIT 100').all(leadId) as Row[]).map((r) => ({
      action: String(r.action),
      detail: s(r.detail),
      runId: s(r.run_id),
      createdAt: String(r.created_at),
    }));
  }

  listLeads(f: { accountId?: string; status?: LeadStatus; taskId?: string; q?: string; limit?: number; offset?: number }): { leads: Lead[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (f.accountId) {
      where.push('l.account_id = @accountId');
      params.accountId = f.accountId;
    }
    if (f.status) {
      where.push('l.status = @status');
      params.status = f.status;
    }
    if (f.taskId) {
      where.push('l.id IN (SELECT lead_id FROM linkedin_task_leads WHERE task_id = @taskId)');
      params.taskId = f.taskId;
    }
    if (f.q) {
      where.push(`(l.name LIKE @q OR IFNULL(l.headline,'') LIKE @q OR IFNULL(l.company,'') LIKE @q OR IFNULL(l.location,'') LIKE @q)`);
      params.q = `%${f.q}%`;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM linkedin_leads l ${clause}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT l.* FROM linkedin_leads l ${clause} ORDER BY l.last_seen_at DESC, l.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: f.limit ?? 50, offset: f.offset ?? 0 }) as Row[];
    return { leads: rows.map(toLead), total };
  }

  // ------------------------------------------------------------------- drafts
  activeDraft(leadId: number): ConnectionDraft | null {
    const r = this.db.prepare(`SELECT * FROM linkedin_connection_drafts WHERE lead_id = ? AND status IN ('pending', 'confirmed')`).get(leadId) as Row | undefined;
    return r ? this.toDraft(r) : null;
  }

  latestDraft(leadId: number): ConnectionDraft | null {
    const r = this.db.prepare('SELECT * FROM linkedin_connection_drafts WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId) as Row | undefined;
    return r ? this.toDraft(r) : null;
  }

  draft(id: number): ConnectionDraft | null {
    const r = this.db.prepare('SELECT * FROM linkedin_connection_drafts WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toDraft(r) : null;
  }

  private toDraft(r: Row): ConnectionDraft {
    return {
      id: Number(r.id),
      leadId: Number(r.lead_id),
      taskId: s(r.task_id),
      note: s(r.note),
      status: r.status as DraftStatus,
      runId: s(r.run_id),
      error: s(r.error),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      lead: this.lead(Number(r.lead_id))!,
    };
  }

  /** Create or update the pending draft of a lead (a confirmed draft is never changed). */
  saveDraft(leadId: number, taskId: string | null, note: string | null): ConnectionDraft {
    const existing = this.activeDraft(leadId);
    const t = now();
    if (existing) {
      if (existing.status !== 'pending') return existing;
      this.db.prepare('UPDATE linkedin_connection_drafts SET note = ?, updated_at = ? WHERE id = ?').run(note, t, existing.id);
      return this.draft(existing.id)!;
    }
    const info = this.db
      .prepare(`INSERT INTO linkedin_connection_drafts (lead_id, task_id, note, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`)
      .run(leadId, taskId, note, t, t);
    return this.draft(Number(info.lastInsertRowid))!;
  }

  setDraftStatus(id: number, status: DraftStatus, patch: { runId?: string | null; error?: string | null; note?: string | null } = {}) {
    const d = this.draft(id);
    if (!d) return;
    this.db
      .prepare('UPDATE linkedin_connection_drafts SET status = ?, run_id = ?, error = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(status, patch.runId !== undefined ? patch.runId : d.runId, patch.error ?? null, patch.note !== undefined ? patch.note : d.note, now(), id);
  }

  listDrafts(f: { status?: DraftStatus; taskId?: string; accountId?: string }): ConnectionDraft[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (f.status) {
      where.push('d.status = @status');
      params.status = f.status;
    }
    if (f.taskId) {
      where.push('d.task_id = @taskId');
      params.taskId = f.taskId;
    }
    if (f.accountId) {
      where.push('l.account_id = @accountId');
      params.accountId = f.accountId;
    }
    const rows = this.db
      .prepare(
        `SELECT d.* FROM linkedin_connection_drafts d JOIN linkedin_leads l ON l.id = d.lead_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.id DESC LIMIT 500`,
      )
      .all(params) as Row[];
    return rows.map((r) => this.toDraft(r));
  }

  pendingCount(taskId: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM linkedin_connection_drafts WHERE task_id = ? AND status = 'pending'`).get(taskId) as { n: number }).n;
  }

  // ----------------------------------------------------------------- searches
  insertSearch(x: Omit<LinkedInSearch, 'id' | 'createdAt'>): LinkedInSearch {
    const info = this.db
      .prepare(
        `INSERT INTO linkedin_searches (task_id, run_id, keywords, location, company, job_titles, industry, connection_degree, filters_json,
           results_read, matched, new_leads, candidates, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        x.taskId,
        x.runId,
        x.keywords,
        x.location,
        x.company,
        JSON.stringify(x.jobTitles),
        x.industry,
        x.connectionDegree,
        JSON.stringify(x.filters),
        x.resultsRead,
        x.matched,
        x.newLeads,
        x.candidates,
        now(),
      );
    const id = Number(info.lastInsertRowid);
    this.db
      .prepare(
        `INSERT INTO linkedin_tasks (task_id, last_search_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET last_search_id = excluded.last_search_id, updated_at = excluded.updated_at`,
      )
      .run(x.taskId, id, now());
    return this.searches({ id })[0]!;
  }

  searches(f: { taskId?: string; id?: number; limit?: number }): LinkedInSearch[] {
    if (f.id) return (this.db.prepare('SELECT * FROM linkedin_searches WHERE id = ?').all(f.id) as Row[]).map(toSearch);
    const rows = f.taskId
      ? this.db.prepare('SELECT * FROM linkedin_searches WHERE task_id = ? ORDER BY id DESC LIMIT ?').all(f.taskId, f.limit ?? 20)
      : this.db.prepare('SELECT * FROM linkedin_searches ORDER BY id DESC LIMIT ?').all(f.limit ?? 50);
    return (rows as Row[]).map(toSearch);
  }

  taskStats(taskIds: string[]): LinkedInTaskStats[] {
    return taskIds.map((taskId) => {
      const found = (this.db.prepare('SELECT COUNT(*) AS n FROM linkedin_task_leads WHERE task_id = ?').get(taskId) as { n: number }).n;
      const sent = (
        this.db.prepare(`SELECT COUNT(*) AS n FROM linkedin_connection_drafts WHERE task_id = ? AND status = 'sent'`).get(taskId) as { n: number }
      ).n;
      const last = this.db.prepare('SELECT last_search_id AS id FROM linkedin_tasks WHERE task_id = ?').get(taskId) as { id: number | null } | undefined;
      return {
        taskId,
        leadsFound: found,
        pendingReview: this.pendingCount(taskId),
        connectionsSent: sent,
        lastSearch: last?.id ? (this.searches({ id: last.id })[0] ?? null) : null,
      };
    });
  }

  stats(accountId: string | null, todayIso: string): LinkedInStats {
    const scope = accountId ? 'WHERE account_id = @accountId' : '';
    const byStatus = Object.fromEntries(
      (this.db.prepare(`SELECT status, COUNT(*) AS n FROM linkedin_leads ${scope} GROUP BY status`).all({ accountId }) as Array<{ status: string; n: number }>).map(
        (r) => [r.status, r.n],
      ),
    ) as Partial<Record<LeadStatus, number>>;
    const total = Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0);
    const today = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM linkedin_leads ${scope ? `${scope} AND` : 'WHERE'} first_seen_at >= @today`).get({ accountId, today: todayIso }) as {
        n: number;
      }
    ).n;
    const pending = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM linkedin_connection_drafts d JOIN linkedin_leads l ON l.id = d.lead_id
           WHERE d.status = 'pending' ${accountId ? 'AND l.account_id = @accountId' : ''}`,
        )
        .get({ accountId }) as { n: number }
    ).n;
    // Reviewed = leads a person acted on (viewed, selected, skipped, edited a note or confirmed).
    const reviewed = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT a.lead_id) AS n FROM linkedin_lead_actions a JOIN linkedin_leads l ON l.id = a.lead_id
           WHERE a.action IN ('REVIEWED', 'SELECTED', 'SKIPPED', 'NOTE_EDITED', 'CONFIRMED') ${accountId ? 'AND l.account_id = @accountId' : ''}`,
        )
        .get({ accountId }) as { n: number }
    ).n;
    const n = (st: LeadStatus) => byStatus[st] ?? 0;
    return {
      leadsFound: total,
      leadsToday: today,
      reviewed,
      // Picked by a person (prepared-but-unreviewed drafts are counted in pendingReview instead).
      selected: n('SELECTED') + n('CONNECTION_CONFIRMED'),
      pendingReview: pending,
      connectionsSent: n('CONNECTION_SENT'),
      connected: n('CONNECTED'),
      skipped: n('SKIPPED'),
      failed: n('FAILED'),
    };
  }
}
