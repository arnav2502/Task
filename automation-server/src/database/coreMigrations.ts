import type { Migration } from './database.js';

/**
 * Generic schema. Nothing here is platform-specific: platform data lives in tables owned by the
 * adapter (see adapters/<platform>/migrations.ts).
 */
export const CORE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'generic automation platform schema',
    up: `
    CREATE TABLE platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL REFERENCES platforms(id),
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      status_message TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      mode_override TEXT,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (platform_id, username)
    );
    CREATE INDEX idx_accounts_platform ON accounts(platform_id);

    -- Only a reference ("keyring:<id>" / "vault:<id>") is stored; the secret lives in the OS keychain or the encrypted vault.
    CREATE TABLE credentials (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      backend TEXT NOT NULL,
      reference TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE browser_profiles (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      platform_id TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      last_cleared_at TEXT
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_id TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (account_id, task_type)
    );
    CREATE INDEX idx_tasks_platform ON tasks(platform_id);

    -- account_id NULL = platform-wide default for the task type; otherwise that account's override.
    CREATE TABLE task_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      config TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX ux_task_configs_scope ON task_configs(platform_id, task_type, IFNULL(account_id, ''));

    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      frequency TEXT NOT NULL,
      time TEXT NOT NULL,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      once_date TEXT,
      window_end TEXT,
      random_minute INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'default',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_schedules_task ON schedules(task_id);
    CREATE INDEX idx_schedules_next ON schedules(enabled, next_run_at);

    -- No FK to accounts: history outlives a deleted account (account_name is a snapshot).
    CREATE TABLE execution_runs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      task_id TEXT,
      task_type TEXT NOT NULL,
      task_name TEXT NOT NULL,
      schedule_id TEXT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      stage TEXT,
      current_step TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_code TEXT,
      error TEXT,
      result_message TEXT,
      result TEXT,
      screenshot_path TEXT,
      log_path TEXT,
      retry_of TEXT
    );
    CREATE INDEX idx_runs_queued ON execution_runs(queued_at);
    CREATE INDEX idx_runs_account ON execution_runs(account_id, queued_at);
    CREATE INDEX idx_runs_platform ON execution_runs(platform_id, queued_at);
    CREATE INDEX idx_runs_status ON execution_runs(status);
    CREATE INDEX idx_runs_task ON execution_runs(task_id, queued_at);

    CREATE TABLE run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      stage TEXT,
      message TEXT NOT NULL
    );
    CREATE INDEX idx_run_logs_run ON run_logs(run_id, id);

    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      platform_id TEXT,
      account_id TEXT,
      run_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_notifications_read ON notifications(read, id);

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      platform_id TEXT,
      account_id TEXT,
      run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_created ON events(created_at);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Service-internal values (API token, paired extension id, run sequence …).
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    `,
  },
  {
    version: 2,
    description: 'multi-instance tasks, per-task config, review outcome, action payloads, notification links',
    foreignKeysOff: true,
    up: `
    -- tasks: drop UNIQUE(account_id, task_type) so a task type can have several named instances.
    -- Singleton tasks (name NULL) stay unique per account through a partial index.
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_id TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO tasks_new (id, platform_id, account_id, task_type, name, enabled, last_run_id, last_run_at, last_status, last_error,
      success_count, failure_count, created_at, updated_at)
    SELECT id, platform_id, account_id, task_type, NULL, enabled, last_run_id, last_run_at, last_status, last_error,
      success_count, failure_count, created_at, updated_at FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX idx_tasks_platform ON tasks(platform_id);
    CREATE INDEX idx_tasks_account ON tasks(account_id);
    CREATE UNIQUE INDEX ux_tasks_singleton ON tasks(account_id, task_type) WHERE name IS NULL;

    -- task_configs: a fourth scope — one task instance (multi-instance tasks keep their own configuration).
    ALTER TABLE task_configs ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
    DROP INDEX ux_task_configs_scope;
    CREATE UNIQUE INDEX ux_task_configs_scope ON task_configs(platform_id, task_type, IFNULL(account_id, ''), IFNULL(task_id, ''));

    -- runs: payload of user-confirmed actions (e.g. which lead to connect with) and review counts.
    ALTER TABLE execution_runs ADD COLUMN payload TEXT;
    ALTER TABLE execution_runs ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;

    -- notifications: optional in-app destination ("Review now").
    ALTER TABLE notifications ADD COLUMN link TEXT;
    `,
  },
];
