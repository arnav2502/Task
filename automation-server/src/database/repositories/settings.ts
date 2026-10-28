import { DEFAULT_SETTINGS, type Settings } from '@shared/types/index.js';
import type { SqliteDb } from '../database.js';
import type { Row } from './util.js';

/** Global settings (key → JSON, merged over the defaults) and the internal key/value store. */
export class SettingsRepository {
  constructor(private readonly db: SqliteDb) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const stored: Record<string, unknown> = {};
    for (const r of rows) {
      const key = String(r.key);
      if (!(key in DEFAULT_SETTINGS)) continue;
      try {
        stored[key] = JSON.parse(String(r.value));
      } catch {
        /* ignore a corrupt value; the default applies */
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored } as Settings;
  }

  save(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
    })();
    return this.get();
  }

  getKv(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  setKv(key: string, value: string) {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteKv(key: string) {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }
}
