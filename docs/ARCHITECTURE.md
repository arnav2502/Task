# Architecture

```
┌──────────────── Chrome extension (control panel only) ────────────────┐
│ React pages ── services/api.ts (HTTP) ── services/live.ts (WebSocket) │
│ background.ts: heartbeat · Chrome notifications · badge · auto-pair   │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ 127.0.0.1:47400, bearer token
┌───────────────────────────────▼───────── Local automation service ────┐
│ server/   security → generic routes → adapter routes (/platforms/<id>)│
│ scheduler/  ──fires──▶ tasks/TaskExecutor ◀──enqueue── API (Run now)  │
│                            │    ▲                                     │
│                   queue/JobQueue (priority, 1 job/account, N parallel)│
│                            │                                          │
│      STARTED → prepare → LOGIN_CHECK → TASK_EXECUTION → VERIFICATION → COMPLETED
│                            │ (retries · timeout · cancel · screenshots · run log)
│                            ▼                                          │
│ adapters/registry ── PlatformAdapter: naukri | linkedin* | indeed* …  │
│ browser/BrowserManager: one persistent profile per account            │
│ database/ (SQLite) · credentials/ (keychain/vault) · notifications/   │
└───────────────────────────────────────────────────────────────────────┘
* coming soon
```

## Core ideas

**1. Platforms are adapters.** The core never imports a platform. It looks adapters up in the
`AdapterRegistry` and talks to them only through `PlatformAdapter`
([`adapters/base/platformAdapter.ts`](../automation-server/src/adapters/base/platformAdapter.ts)):

| Member | Purpose |
|---|---|
| `platformId`, `platformName`, `descriptor` | Identity, plus a declarative description: status, capabilities, task types with config fields, planned tasks, notes |
| `getAccounts()` / `getTasks()` / `getTask()` | The platform's accounts and the task types the UI renders |
| `parseTaskConfig()` | Zod validation of a task configuration |
| `checkSession()` / `authenticate()` | Is the saved session valid? Make sure it is signed in |
| `executeTask()` | Run one task type |
| `validate()` | Read-only selector health check |
| `disconnect()` | Platform clean-up when a session is cleared |
| optional `preflight`, `prepareTask`, `timeoutSec`, `getMetrics`, `routes`, `migrations` | Hooks the core calls when present |

**2. Tasks are generic instances.** When an account is added, the core creates one task per task type the adapter declares
(`tasks` table). The UI lists task types, renders their configuration forms (`ConfigField[]`), and schedules and runs them,
all from the descriptor. LinkedIn's future `CONNECT_PEOPLE` needs no dashboard changes.

**3. Configuration is layered.** It is resolved in this order:
1. Task-type defaults (from the adapter).
2. Platform defaults (`task_configs` with `account_id IS NULL`).
3. The account's override.

The adapter validates the result with Zod. Naukri's "resume folder with per-account override" is simply this layering.

**4. One queue, one scheduler, one history.** All of them are keyed by task id and account id, never by platform:

| Component | What it does |
|---|---|
| `JobQueue` | Priority ordering (manual 100 > scheduled 50, FIFO within a level). At most one job per account, because a browser profile can be opened only once. Global concurrency limit. Duplicate key per task. Cancel and reservations. |
| `Scheduler` | Once / daily / weekly / specific days / hourly window with a random minute. Stores `nextRunAt` per schedule. Missed runs are skipped, or run after a random 2–6 min delay. Optional "only while Chrome is open" gate. |
| `TaskExecutor` | The run pipeline above. |

The `TaskExecutor` pipeline:
- Fails fast before a browser opens (adapter `prepareTask`).
- Opens the account browser lazily (`AutomationSession.page()`).
- Retries only retryable failures; task types can opt out (Share Interest).
- Applies a per-task timeout and cancellation (closing the browser).
- Saves screenshots and a per-run log: DB lines carry their stage, there is a text file, and lines stream live.
- Updates the account status from the error category and raises notifications.

**5. Errors extend one model.** `AutomationError` has a generic `category` (`AUTH_REQUIRED`, `OTP_REQUIRED`,
`CAPTCHA_REQUIRED`, `SESSION_EXPIRED`, `ELEMENT_NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`, `TASK_FAILED`,
`PLATFORM_BLOCKED`, …) and a `code`. `CATEGORY_RULES` decide the retry, the run status (`failed` / `action_required` /
`cancelled`), the account status and the notification type. Platforms add codes such as `NAUKRI_RESUME_NOT_FOUND`
that map onto a category.

**6. Isolation.** Each account has its own persistent Chromium profile:
`data/accounts/<platform>/<accountId>/browser-profile`. Chromium's password manager is disabled in it.

**7. Background mode.** A real headed browser runs with its windows hidden. On Windows a hidden PowerShell watcher started
before launch re-hides any window; elsewhere the browser starts minimized. Sites see a normal browser; nothing is spoofed.

**8. Multi-instance tasks, reviews and user-confirmed actions** (added with LinkedIn, generic for every platform):
- A task type can be `multiInstance` — the user creates named instances (`POST /tasks`), each with its own configuration and schedules.
- An adapter can return `review` from a run: the run ends `waiting_for_review`, the task is `WAITING_FOR_REVIEW` until the adapter's
  `pendingReview(taskId)` reaches 0, and an ACTION_REQUIRED notification links to the review screen.
- Adapter **actions** (e.g. LinkedIn `SEND_CONNECTION`) are side-effecting operations a person explicitly requested. They use the same
  queue, logs and history, are never retried automatically, and can only be enqueued with trigger `manual`/`retry` — the scheduler
  only ever enqueues task ids, so it cannot start one.

## Run lifecycle

```
enqueue (manual / schedule / missed / retry)
  → execution_runs row (RUN-YYYYMMDD-NNNNNN, queued) → queue
  → running: ▶ STARTED
      effective config (fails CONFIG_INVALID without a browser)
      adapter.prepareTask      e.g. find the resume PDF
      adapter.preflight        e.g. headless-block probe
      ▶ LOGIN CHECK            adapter.authenticate: reuse the session / log in / pause on OTP
      ▶ TASK EXECUTION         adapter.executeTask
      ▶ VERIFICATION           reload and confirm the change really happened (adapter)
  → ▶ SUCCESS | FAILED         run row, task counters, account status, notification, screenshot
```

## OTP / CAPTCHA

- **Unattended** (background or headless) runs never put a window on screen. They stop with `OTP_REQUIRED` or
  `CAPTCHA_REQUIRED`: the run status becomes `action_required`, the account is flagged, and an ACTION_REQUIRED
  notification is sent.
- **Connect** (and headed runs) show the window and wait up to *Verification wait* for the person to finish.

Nothing is ever solved or bypassed.

## Security

See the table in [API.md](API.md#security-model). The service is localhost-only, checks the Host header, restricts CORS to
extensions, pairs with one extension, requires a constant-time bearer token, and validates input with Zod. Passwords are
read only when about to be typed; they are registered for redaction, so every logger masks them.

## Extension

The extension is a control panel; it never runs automation.
- **Data:** a hash router and an app-state context. `useResource` hooks re-fetch on matching WebSocket messages.
- **Generic pages:** Dashboard, Platforms, Accounts, Tasks, Schedules, History with Run Details, Notifications, Settings.
- **Platform page:** generic tabs plus platform extensions from `pages/platforms/registry.tsx` (Naukri adds Resume and Share Interest).
- **Background worker:** a 30 s heartbeat, which also drives "Run only while Chrome is open". It turns new notifications
  into Chrome notifications and shows a badge with the active-run count, `off` or `!`.
