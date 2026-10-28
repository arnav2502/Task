import type { ActivityEvent, AppNotification, NotificationType } from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import { bool, nowIso, num, str, type Row } from './util.js';

export interface NewNotification {
  type: NotificationType;
  title: string;
  message: string;
  platformId?: string | null;
  accountId?: string | null;
  runId?: string | null;
  link?: string | null;
}

function toNotification(r: Row): AppNotification {
  return {
    id: num(r.id),
    type: r.type as NotificationType,
    title: String(r.title),
    message: String(r.message),
    platformId: str(r.platform_id),
    accountId: str(r.account_id),
    runId: str(r.run_id),
    link: str(r.link),
    read: bool(r.read),
    createdAt: String(r.created_at),
  };
}

export class NotificationsRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(n: NewNotification): AppNotification {
    const info = this.db
      .prepare('INSERT INTO notifications (type, title, message, platform_id, account_id, run_id, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.type, n.title, n.message, n.platformId ?? null, n.accountId ?? null, n.runId ?? null, n.link ?? null, nowIso());
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): AppNotification | null {
    const r = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Row | undefined;
    return r ? toNotification(r) : null;
  }

  list(opts: { unreadOnly?: boolean; after?: number; limit?: number } = {}): AppNotification[] {
    const where = ['id > @after'];
    if (opts.unreadOnly) where.push('read = 0');
    return (
      this.db
        .prepare(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit`)
        .all({ after: opts.after ?? 0, limit: opts.limit ?? 100 }) as Row[]
    ).map(toNotification);
  }

  unreadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get() as { n: number }).n;
  }

  latestId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM notifications').get() as { id: number }).id;
  }

  markRead(ids: number[] | 'all') {
    if (ids === 'all') this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    else {
      const stmt = this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?');
      this.db.transaction(() => ids.forEach((id) => stmt.run(id)))();
    }
  }

  clear() {
    this.db.prepare('DELETE FROM notifications').run();
  }

  deleteBefore(cutoff: string): number {
    return this.db.prepare('DELETE FROM notifications WHERE created_at < ? AND read = 1').run(cutoff).changes;
  }
}

export class EventsRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(e: { type: string; message: string; platformId?: string | null; accountId?: string | null; runId?: string | null }): ActivityEvent {
    const info = this.db
      .prepare('INSERT INTO events (type, message, platform_id, account_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.type, e.message, e.platformId ?? null, e.accountId ?? null, e.runId ?? null, nowIso());
    return this.list(1, Number(info.lastInsertRowid))[0]!;
  }

  list(limit = 100, id?: number): ActivityEvent[] {
    const rows = (id
      ? this.db.prepare('SELECT * FROM events WHERE id = ?').all(id)
      : this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit)) as Row[];
    return rows.map((r) => ({
      id: num(r.id),
      type: String(r.type),
      message: String(r.message),
      platformId: str(r.platform_id),
      accountId: str(r.account_id),
      runId: str(r.run_id),
      createdAt: String(r.created_at),
    }));
  }

  deleteBefore(cutoff: string): number {
    return this.db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff).changes;
  }
}
