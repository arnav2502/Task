import type { SqliteDb } from '../database.js';
import { nowIso } from './util.js';

/** Persists the registry of platforms so accounts can reference them with a foreign key. */
export class PlatformsRepository {
  constructor(private readonly db: SqliteDb) {}

  sync(platforms: Array<{ id: string; name: string; status: string }>) {
    const stmt = this.db.prepare(`
      INSERT INTO platforms (id, name, status, enabled, registered_at, updated_at)
      VALUES (@id, @name, @status, 1, @now, @now)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, updated_at = excluded.updated_at`);
    const now = nowIso();
    this.db.transaction(() => platforms.forEach((p) => stmt.run({ ...p, now })))();
  }

  ids(): string[] {
    return (this.db.prepare('SELECT id FROM platforms ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
  }
}
