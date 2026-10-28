import type { Account, AccountStatus, BrowserMode, CredentialBackend } from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import { bool, nowIso, setClause, str, type Row } from './util.js';

/** Internal record: unmasked username. Never sent to the extension as-is. */
export interface AccountRecord extends Omit<Account, 'hasCredentials'> {
  hasCredentials: boolean;
}

export interface AccountPatch {
  name?: string;
  username?: string;
  status?: AccountStatus;
  statusMessage?: string | null;
  enabled?: boolean;
  modeOverride?: BrowserMode | null;
  lastCheckedAt?: string | null;
}

const COLUMNS: Record<keyof AccountPatch, string> = {
  name: 'name',
  username: 'username',
  status: 'status',
  statusMessage: 'status_message',
  enabled: 'enabled',
  modeOverride: 'mode_override',
  lastCheckedAt: 'last_checked_at',
};

const SELECT = `SELECT a.*, (c.account_id IS NOT NULL) AS has_credentials FROM accounts a LEFT JOIN credentials c ON c.account_id = a.id`;

function toAccount(r: Row): AccountRecord {
  return {
    id: String(r.id),
    platformId: String(r.platform_id),
    name: String(r.name),
    username: String(r.username),
    status: r.status as AccountStatus,
    statusMessage: str(r.status_message),
    enabled: bool(r.enabled),
    modeOverride: (str(r.mode_override) as BrowserMode | null) ?? null,
    hasCredentials: bool(r.has_credentials),
    lastCheckedAt: str(r.last_checked_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class AccountsRepository {
  constructor(private readonly db: SqliteDb) {}

  list(platformId?: string): AccountRecord[] {
    const rows = platformId
      ? this.db.prepare(`${SELECT} WHERE a.platform_id = ? ORDER BY a.created_at`).all(platformId)
      : this.db.prepare(`${SELECT} ORDER BY a.platform_id, a.created_at`).all();
    return (rows as Row[]).map(toAccount);
  }

  get(id: string): AccountRecord | null {
    const r = this.db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
    return r ? toAccount(r) : null;
  }

  findByUsername(platformId: string, username: string): AccountRecord | null {
    const r = this.db.prepare(`${SELECT} WHERE a.platform_id = ? AND lower(a.username) = lower(?)`).get(platformId, username) as Row | undefined;
    return r ? toAccount(r) : null;
  }

  insert(a: { id: string; platformId: string; name: string; username: string; enabled: boolean; modeOverride: BrowserMode | null }): AccountRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO accounts (id, platform_id, name, username, status, enabled, mode_override, created_at, updated_at)
         VALUES (@id, @platformId, @name, @username, 'unknown', @enabled, @modeOverride, @now, @now)`,
      )
      .run({ ...a, enabled: a.enabled ? 1 : 0, now });
    return this.get(a.id)!;
  }

  update(id: string, patch: AccountPatch): AccountRecord | null {
    const { sql, params } = setClause(patch as Record<string, unknown>, COLUMNS);
    if (sql) this.db.prepare(`UPDATE accounts SET ${sql}, updated_at = @now WHERE id = @id`).run({ ...params, id, now: nowIso() });
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
  }

  // ---------------------------------------------------------------- credentials
  credentialRef(accountId: string): { backend: CredentialBackend; reference: string } | null {
    const r = this.db.prepare('SELECT backend, reference FROM credentials WHERE account_id = ?').get(accountId) as Row | undefined;
    return r ? { backend: r.backend as CredentialBackend, reference: String(r.reference) } : null;
  }

  setCredentialRef(accountId: string, backend: CredentialBackend, reference: string) {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO credentials (account_id, backend, reference, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET backend = excluded.backend, reference = excluded.reference, updated_at = excluded.updated_at`,
      )
      .run(accountId, backend, reference, now, now);
  }

  // ------------------------------------------------------------ browser profiles
  setBrowserProfile(accountId: string, platformId: string, profilePath: string) {
    this.db
      .prepare(
        `INSERT INTO browser_profiles (account_id, platform_id, path, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET path = excluded.path`,
      )
      .run(accountId, platformId, profilePath, nowIso());
  }

  browserProfilePath(accountId: string): string | null {
    const r = this.db.prepare('SELECT path FROM browser_profiles WHERE account_id = ?').get(accountId) as Row | undefined;
    return r ? String(r.path) : null;
  }

  touchBrowserProfile(accountId: string, field: 'last_used_at' | 'last_cleared_at') {
    this.db.prepare(`UPDATE browser_profiles SET ${field} = ? WHERE account_id = ?`).run(nowIso(), accountId);
  }
}
