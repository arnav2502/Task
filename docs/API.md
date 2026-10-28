# TaskPilot local API

Base URL: `http://127.0.0.1:47400` (port from `PORT` in `.env`). The service only listens on `127.0.0.1`. The extension's
CSP allows any loopback port, so a changed port only needs the Service URL updated in Settings.

Types referenced below live in [`shared/types/index.ts`](../shared/types/index.ts) (generic) and
[`shared/types/naukri.ts`](../shared/types/naukri.ts) (Naukri module). Request bodies are validated with
the Zod schemas in [`shared/schemas/index.ts`](../shared/schemas/index.ts).

## Security model

| Guard | Behaviour |
|---|---|
| Bind address | `127.0.0.1` only. Never reachable from the network. |
| Host header | Must be `127.0.0.1:<port>` or `localhost:<port>`, otherwise `403` (blocks DNS rebinding). |
| CORS | Only `chrome-extension://` origins get CORS headers. Any other `Origin` → `403`. |
| Pairing | `POST /pair` from the extension. The first extension ID is trusted (or the one pinned by `TASKPILOT_EXTENSION_ID`). Another extension → `403`. Reset with `npm run pair:reset`. |
| Token | Every route except `/health` and `/pair` needs `Authorization: Bearer <token>`. Compared in constant time. |
| WebSocket | `ws://127.0.0.1:47400/ws?token=<token>`. Wrong token or a non-extension `Origin` → `401`. |
| Credentials | Passwords go in on `POST/PUT /accounts` only. They are never returned, logged or sent to the extension. Usernames are always masked. |

Errors use this shape: `{ "error": "human readable message", "code"?: "MACHINE_CODE" }`.

| Status | When |
|---|---|
| 400 | Validation failed (Zod message), invalid task configuration |
| 401 | Missing / wrong token |
| 403 | Host / Origin / pairing refused |
| 404 | Unknown id |
| 409 | Conflict: task already queued or running, account busy, platform not available |

## Public

| Method & path | Response |
|---|---|
| `GET /health` | `HealthResponse` |
| `POST /pair` | `{ token }`. Must be called with a `chrome-extension://<id>` Origin. |

## Dashboard and system

| Method & path | Body / query | Response |
|---|---|---|
| `GET /dashboard` | | `DashboardData` |
| `POST /heartbeat` | | `{ ok, active, unreadNotifications, latestNotificationId }`. Sent every 30 s by the extension; drives "Run only while Chrome is open". |
| `GET /queue` | | `QueueSnapshot` |
| `GET /settings` | | `Settings` |
| `PUT /settings` | partial `Settings` | `Settings` |
| `GET /events` | `?limit=` | `ActivityEvent[]` (audit trail: account added, schedule missed, pairing …) |
| `POST /system/pick-folder` | `{ initial? }` | `{ path: string \| null }`. Opens the native folder picker on this computer. |

## Platforms

| Method & path | Body | Response |
|---|---|---|
| `GET /platforms` | | `PlatformDescriptor[]`. All registered platforms, active and coming soon. |
| `GET /platforms/:id` | | `PlatformDescriptor & { activity: PlatformActivity }` |
| `GET /platforms/:id/tasks/:taskType/config` | | `{ configuration }`: platform-wide defaults for that task type |
| `PUT /platforms/:id/tasks/:taskType/config` | `{ configuration }` | `{ configuration }`. Validated by the adapter. |

## Accounts

| Method & path | Body / query | Response |
|---|---|---|
| `GET /accounts` | `?platformId=` | `AccountSummary[]` |
| `GET /accounts/:id` | | `AccountSummary` |
| `POST /accounts` | `{ platformId, name, username, password?, enabled?, modeOverride? }` | `201 Account`. Creates one task instance per task type of the platform. `409` for coming-soon platforms. |
| `PUT /accounts/:id` | `{ name?, username?, password?, enabled?, modeOverride? }` | `Account`. Empty password = keep the stored one. |
| `DELETE /accounts/:id` | | `204`. Removes credentials, browser profile, tasks, schedules and platform data. `409` while busy. |
| `POST /accounts/:id/connect` | | `202 ExecutionRun`. Opens a visible browser for sign-in / OTP. |
| `POST /accounts/:id/test-login` | `{ mode? }` | `202 ExecutionRun` |
| `POST /accounts/:id/disconnect` | | `Account`. Clears the saved browser session and keeps the password. |
| `POST /accounts/:id/validate` | | `ValidationCheck[]`. Read-only selector health check. Runs as a queued `VALIDATE` run (visible in history) and answers when it finishes (up to 5 min). |

## Tasks

A **task** is one task type of one platform for one account (for example *Naukri · Personal · Profile
Update*). Configuration is layered: task-type defaults ← platform defaults ← the account's override.

| Method & path | Body / query | Response |
|---|---|---|
| `GET /tasks` | `?platformId=&accountId=` | `Task[]` |
| `GET /tasks/:id` | | `Task` |
| `POST /tasks` | `{ accountId, taskType, name, configuration?, enabled? }` | `201 Task` — a named instance of a **multi-instance** task type (e.g. a LinkedIn lead search) |
| `PUT /tasks/:id` | `{ name?, enabled?, configuration?, resetConfiguration? }` | `Task` (`name` only for multi-instance tasks) |
| `DELETE /tasks/:id` | | `204` — multi-instance tasks only (schedules and config cascade); `409` while queued/running |
| `POST /tasks/:id/run` | `{ mode? }` | `202 ExecutionRun`. `409` if already queued or running. |

## Schedules

| Method & path | Body / query | Response |
|---|---|---|
| `GET /schedules` | `?platformId=&accountId=&taskId=` | `Schedule[]` |
| `POST /schedules` | `{ taskId, frequency, time, daysOfWeek?, onceDate?, windowEnd?, randomMinute?, mode?, enabled? }` | `201 Schedule` |
| `PUT /schedules/:id` | any of the fields above except `taskId` | `Schedule` |
| `DELETE /schedules/:id` | | `204` |

Frequencies: `once` (needs `onceDate`), `daily`, `weekly` (exactly one day), `specific_days` (at least one day),
and `hourly` (`time` to `windowEnd`, one run per hour, optional `randomMinute`).

## Execution runs

| Method & path | Body / query | Response |
|---|---|---|
| `GET /runs` | `?platformId&accountId&taskType&taskId&status&trigger&from&to&limit&offset` | `RunPage` |
| `GET /runs/:id` | | `RunDetails` (logs + timeline) |
| `POST /runs/:id/cancel` | | `{ cancelled: boolean }` |
| `POST /runs/:id/retry` | | `202 ExecutionRun` (new run, `trigger: "retry"`, `retryOf` set) |
| `GET /runs/:id/screenshot` | | `image/png` |
| `GET /runs/:id/log` | | `text/plain`: the full log file |

Run statuses: `queued`, `running`, `success`, `waiting_for_review` (finished; prepared items await your review — see `reviewCount`), `failed`, `action_required`, `cancelled`, `skipped`.
Task states (`Task.state`): `DRAFT`, `SCHEDULED`, `RUNNING`, `WAITING_FOR_REVIEW`, `COMPLETED`, `FAILED`, `CANCELLED`.

Run ids look like `RUN-20261026-000123`. Stages: `STARTED → LOGIN_CHECK → TASK_EXECUTION → VERIFICATION → COMPLETED`.
Account-level system runs (`taskId: null`) use the task types `CONNECT`, `TEST_LOGIN` and `VALIDATE`.

## Notifications

| Method & path | Body / query | Response |
|---|---|---|
| `GET /notifications` | `?unreadOnly=true&after=<id>&limit=` | `{ notifications: AppNotification[], unread, latestId }` |
| `POST /notifications/read` | `{ ids? , all? }` | `{ unread }` |
| `DELETE /notifications` | | `204` (clears all) |

Types: `SUCCESS`, `WARNING`, `ERROR`, `INFO`, `ACTION_REQUIRED`.

## WebSocket `/ws`

Server → client JSON messages (`LiveMessage`):

```
run:update      { run }            queued/running/finished, step and stage changes
run:log         { line }           every log line of every run, live
account:update  { account }        account:deleted { accountId }
tasks:changed   { accountId }      schedules:changed
queue:changed   { queue }          notification { notification }
settings:changed { settings }
```

## Naukri module routes

Only the Naukri adapter registers these, under `/platforms/naukri`.

| Method & path | Body / query | Response |
|---|---|---|
| `GET /platforms/naukri/resume/scan` | `?accountId=` (omit for platform default) | `ResumeFolderScan`, scanned fresh |
| `POST /platforms/naukri/resume/scan` | `{ folderPath, selectionMode, specificFile? }` | `ResumeFolderScan` (preview before saving) |
| `GET /platforms/naukri/shared-jobs` | `?accountId=&limit=` | `SharedJobsResponse` |
| `POST /platforms/naukri/accounts/:id/reset-baseline` | | `204`. Re-learn the headline baseline on the next Profile Update. |

## LinkedIn module routes

Mounted under `/platforms/linkedin` — see [LINKEDIN.md](LINKEDIN.md#api-all-under-platformslinkedin-bearer-token-required).
`POST /platforms/linkedin/leads/:id/confirm-connection { confirm: true, note? }` is the **only** way a connection request is sent;
it queues one `SEND_CONNECTION` action run. Actions can be started only by you (`manual` / `retry`), never by a schedule.
