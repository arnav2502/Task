import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CORE_MIGRATIONS } from './coreMigrations.js';
import { AccountsRepository } from './repositories/accounts.js';
import { NotificationsRepository, EventsRepository } from './repositories/notifications.js';
import { PlatformsRepository } from './repositories/platforms.js';
import { RunsRepository } from './repositories/runs.js';
import { SchedulesRepository } from './repositories/schedules.js';
import { SettingsRepository } from './repositories/settings.js';
import { TasksRepository } from './repositories/tasks.js';

export type SqliteDb = Database.Database;

/** One migration step. Each scope ("core", "naukri", …) has its own version counter. */
export type Migration = {
  version: number;
  description: string;
  up: string;
  /**
   * Table rebuilds (SQLite cannot drop a constraint in place) must run with foreign keys off,
   * otherwise DROP TABLE would cascade-delete dependent rows. Integrity is checked afterwards.
   */
  foreignKeysOff?: boolean;
};

/**
 * SQLite storage. Generic tables are created by the core migrations; each platform adapter adds its
 * own tables (e.g. naukri_shared_jobs) through `migrate(<platformId>, migrations)`, so platform data
 * never leaks into the generic schema.
 */
export class AppDatabase {
  readonly raw: SqliteDb;
  readonly platforms: PlatformsRepository;
  readonly accounts: AccountsRepository;
  readonly tasks: TasksRepository;
  readonly schedules: SchedulesRepository;
  readonly runs: RunsRepository;
  readonly notifications: NotificationsRepository;
  readonly events: EventsRepository;
  readonly settings: SettingsRepository;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('busy_timeout = 5000');
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version)
    )`);
    this.migrate('core', CORE_MIGRATIONS);
    this.platforms = new PlatformsRepository(this.raw);
    this.accounts = new AccountsRepository(this.raw);
    this.tasks = new TasksRepository(this.raw);
    this.schedules = new SchedulesRepository(this.raw);
    this.runs = new RunsRepository(this.raw);
    this.notifications = new NotificationsRepository(this.raw);
    this.events = new EventsRepository(this.raw);
    this.settings = new SettingsRepository(this.raw);
  }

  /** Apply pending migrations of one scope, each in its own transaction. Returns how many ran. */
  migrate(scope: string, migrations: Migration[]): number {
    const current =
      (this.raw.prepare('SELECT MAX(version) AS v FROM schema_migrations WHERE scope = ?').get(scope) as { v: number | null }).v ?? 0;
    const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
    for (const m of pending) {
      if (m.foreignKeysOff) this.raw.pragma('foreign_keys = OFF');
      try {
        this.raw.transaction(() => {
          this.raw.exec(m.up);
          if (m.foreignKeysOff) {
            const broken = this.raw.pragma('foreign_key_check') as unknown[];
            if (broken.length) throw new Error(`Migration ${scope} v${m.version} broke ${broken.length} foreign key(s)`);
          }
          this.raw
            .prepare('INSERT INTO schema_migrations (scope, version, description, applied_at) VALUES (?, ?, ?, ?)')
            .run(scope, m.version, m.description, new Date().toISOString());
        })();
      } finally {
        if (m.foreignKeysOff) this.raw.pragma('foreign_keys = ON');
      }
    }
    return pending.length;
  }

  schemaVersion(scope: string): number {
    return (this.raw.prepare('SELECT MAX(version) AS v FROM schema_migrations WHERE scope = ?').get(scope) as { v: number | null }).v ?? 0;
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  close() {
    this.raw.close();
  }
}
