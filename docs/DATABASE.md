# Database schema

SQLite (`data/taskpilot.sqlite`, WAL, foreign keys on). Migrations live in `schema_migrations(scope, version)`:
- The core schema is scope `core` ([coreMigrations.ts](../automation-server/src/database/coreMigrations.ts)).
- Each adapter migrates its own tables under its platform id (scope `naukri`: [store.ts](../automation-server/src/adapters/naukri/store.ts)).

The generic tables contain no platform-specific columns.

## Generic tables

| Table | Key columns | Notes |
|---|---|---|
| `platforms` | `id` PK, name, status, enabled | Synced from the adapter registry at start-up; FK target for accounts |
| `accounts` | `id` PK, `platform_id` → platforms, name, username, status, status_message, enabled, mode_override, last_checked_at | `UNIQUE(platform_id, username)`. `enabled` = scheduled automation on/off |
| `credentials` | `account_id` PK → accounts (cascade), backend (`keyring`/`vault`), reference | **Reference only** (e.g. `keyring:naukri:<id>`); the secret is in the OS keychain or the encrypted vault |
| `browser_profiles` | `account_id` PK → accounts, platform_id, path UNIQUE, last_used_at, last_cleared_at | One isolated persistent Chromium profile per account |
| `tasks` | `id` PK, platform_id, `account_id` → accounts, task_type, **name**, enabled, last_run_id/at, last_status, last_error, success_count, failure_count | Singleton tasks (`name` NULL) are unique per account+type (partial index); multi-instance tasks (e.g. LinkedIn lead searches) carry a `name`. Type name/description come from the adapter |
| `task_configs` | platform_id, task_type, `account_id` NULL = platform default, `task_id` (multi-instance tasks), config JSON | Unique per scope. Effective config = adapter defaults ← platform default ← account override (singletons) or the instance's own config (multi-instance) |
| `schedules` | `id` PK, platform_id, account_id, `task_id` → tasks (cascade), task_type, frequency, time, days_of_week JSON, once_date, window_end, random_minute, mode, enabled, next_run_at, last_run_at | Indexed by `(enabled, next_run_at)` |
| `execution_runs` | `seq` autoincrement, `id` UNIQUE (`RUN-YYYYMMDD-NNNNNN`), platform_id, account_id, account_name, task_id, task_type, task_name, schedule_id, trigger, status, mode, priority, stage, current_step, attempt, max_attempts, queued/started/completed_at, error_code, error, result_message, result JSON, screenshot_path, log_path, retry_of, **payload** (input of a user-confirmed action), **review_count** | No FK to accounts, so history outlives a deleted account (the name is a snapshot) |
| `run_logs` | `id`, `run_id` → execution_runs (cascade), ts, level, stage, message | The timeline is derived from the first line of each stage |
| `notifications` | `id`, type (SUCCESS/WARNING/ERROR/INFO/ACTION_REQUIRED), title, message, platform_id, account_id, run_id, **link** (in-app route, e.g. Review now), read, created_at | Polled by the extension's background worker |
| `events` | `id`, type, message, platform_id, account_id, run_id, created_at | Audit trail: account added or deleted, pairing, missed schedules |
| `settings` | key, value JSON | Merged over `DEFAULT_SETTINGS` |
| `kv` | key, value | API token, paired extension id |

Status values:
- `accounts.status`: `unknown`, `connected`, `disconnected`, `auth_required`, `login_failed`, `action_required`, `blocked`.
- `execution_runs.status`: `queued`, `running`, `success`, `failed`, `action_required`, `cancelled`, `skipped`.
- `trigger`: `manual`, `schedule`, `missed`, `retry`.
- `stage`: `STARTED`, `LOGIN_CHECK`, `TASK_EXECUTION`, `VERIFICATION`, `COMPLETED`.

## Naukri tables (scope `naukri`)

| Table | Columns | Notes |
|---|---|---|
| `naukri_shared_jobs` | id, `account_id` → accounts (cascade), job_id, title, company, experience, salary, location, status (`shared`/`failed`/`skipped`), message, run_id, shared_at | Every Share Interest attempt. **Never removed by log retention.** It is what guarantees a role is never applied to twice |
| `naukri_profile_state` | `account_id` PK → accounts (cascade), marker_baseline, updated_at | The Resume headline without the marker, so a real trailing "." survives |

## LinkedIn tables (scope `linkedin`)

| Table | Columns | Notes |
|---|---|---|
| `linkedin_leads` | id, `account_id` → accounts (cascade), task_id (last finder), **profile_reference** (`/in/<slug>`), profile_url, name, headline, job_title, company, location, connection_degree, status, last_error, first_seen_at, last_seen_at | `UNIQUE(account_id, profile_reference)` — duplicate protection |
| `linkedin_searches` | id, `task_id` → tasks (cascade), run_id, keywords, location, company, job_titles, industry, connection_degree, filters_json, results_read, matched, new_leads, candidates | One row per Lead Finder run |
| `linkedin_tasks` · `linkedin_task_leads` | task_id, last_search_id · (task_id, lead_id, found_at) | LinkedIn view of each generic Lead Finder task; which leads each task found |
| `linkedin_lead_actions` | id, `lead_id` → leads, action (FOUND/REVIEWED/SELECTED/SKIPPED/PREPARED/NOTE_EDITED/CONFIRMED/QUEUED/SENT/…), detail, run_id | Audit trail per lead |
| `linkedin_connection_drafts` | id, `lead_id` → leads, task_id, note (NULL = no note), status (pending/confirmed/sent/skipped/failed), run_id, error | At most **one active** (pending/confirmed) draft per lead (partial unique index) |

Core migration v2 rebuilt `tasks` (to allow named instances) with foreign keys switched off and verified with
`PRAGMA foreign_key_check`; existing tasks, schedules and configuration are preserved (tested).

## Retention

Hourly (and at start-up), anything older than *Settings → Delete logs older than* (default 7 days) is removed:
- Finished runs with their log lines, log files and screenshots.
- Audit events and read notifications.

Running jobs and platform tables are never touched.
