# TaskPilot — Personal Automation Hub

TaskPilot is a control center for personal browser automations: a Chrome extension (the dashboard)
plus a local automation service that runs Playwright, a scheduler, one job queue, logs, screenshots
and notifications. Platforms plug in as **adapters**.

| Platform | Status | Tasks |
|---|---|---|
| **Naukri** | ✅ Active | Profile Update · Resume Upload · Share Interest |
| **LinkedIn** | ✅ Active | Lead Finder + connection assistant — **you confirm every request** ([docs/LINKEDIN.md](docs/LINKEDIN.md)) |
| Indeed · Glassdoor | Coming soon | Planned tasks are listed in the UI |
| Career Portals · Custom Tasks | Coming soon | Architecture prepared (see [docs/ADDING_A_PLATFORM.md](docs/ADDING_A_PLATFORM.md)) |

```
Chrome extension (React, MV3)  ──HTTP + WebSocket──▶  Local automation service (Node, 127.0.0.1:47400)
   dashboard only, no Playwright                        API · scheduler · queue · executor · SQLite
                                                        credentials · browser manager · logs
                                                                │
                                                        Platform adapters ── naukri / linkedin / …
```

Documentation:
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Database schema](docs/DATABASE.md)
- [Naukri module](docs/NAUKRI.md)
- [LinkedIn module](docs/LINKEDIN.md)
- [Adding a platform](docs/ADDING_A_PLATFORM.md)
- [Testing](docs/TESTING.md)

---

## 1. Folder structure

```
taskpilot/
├── extension/                       Chrome extension (Manifest V3, React 19, Tailwind, Vite)
│   ├── manifest.json                stable "key" → extension ID eapcdbeffkgfkipnobpkcniohiokgejg
│   ├── assets/logo.svg · public/icons/ · scripts/generate-icons.mjs
│   └── src/
│       ├── app/                     App shell, hash router, app state, toasts/confirm
│       ├── background/background.ts heartbeat · Chrome notifications · badge · auto-pair
│       ├── pages/                   Dashboard, Platforms, PlatformPage, Lists (Accounts/Tasks/Schedules),
│       │   └── platforms/           History, Notifications, Settings, Connect (pairing / offline)
│       │       ├── registry.tsx     platform-specific UI extensions (one entry per platform)
│       │       └── naukri/          Resume tab, Share Interest tab, Naukri task actions
│       ├── components/              ui kit, icons, Sidebar, RunDetails, Accounts/Tasks/Schedules/Queue panels,
│       │                            forms (AccountForm, ScheduleForm, ConfigFields — renders any task's config)
│       ├── services/                api.ts (typed client) · live.ts (WebSocket) · storage.ts
│       └── utils/format.ts
│
├── automation-server/
│   ├── scripts/                     pair-reset · import-naukri-tasker · install-autostart
│   └── src/
│       ├── main.ts · container.ts · config.ts
│       ├── server/                  app (security + error mapping), routes, security, dashboardService
│       ├── scheduler/               scheduleMath (pure) · scheduler (one for every platform)
│       ├── queue/jobQueue.ts        priority · concurrency · one job per account · dedupe · cancel
│       ├── tasks/                   taskService (instances + layered config) · taskExecutor (run pipeline)
│       ├── database/                SQLite, migrations per scope, repositories
│       ├── logging/                 app logger (+secret redaction) · run logger · retention
│       ├── accounts/ · credentials/ account service · OS keychain / AES-GCM vault
│       ├── browser/                 per-account persistent browser · hidden windows · selector resolver
│       ├── notifications/ · events/ · errors/ · system/
│       └── adapters/
│           ├── base/                PlatformAdapter contract, base class, coming-soon adapter, registry
│           ├── naukri/              descriptor, selectors, session/login, tasks/*, store, routes
│           └── linkedin/ indeed/ glassdoor/ career-portals/ custom/   (coming soon)
│
├── shared/                          used by both sides
│   ├── types/      index.ts (generic domain) · naukri.ts (Naukri module UI types)
│   ├── constants/  ids, statuses, stages, error codes, priorities
│   └── schemas/    Zod schemas for every API input (service only)
│
├── tests/
│   ├── unit/        Vitest: scheduler, queue, executor (retry/timeout/cancel), accounts, credentials,
│   │                API security, adapter loading, database, Naukri logic
│   ├── e2e/         Playwright Test: Naukri adapter vs mock site, Share Interest, extension ↔ service,
│   │                background mode, tsx runtime
│   ├── mock/        mock Naukri site (DOM mirrors the live site)
│   └── helpers/     isolated service stack, fake executor
└── docs/
```

## 2. Installation

Requirements: Windows 10/11 (macOS/Linux work, but hidden background windows are Windows-only), Node.js **20.10+** (22.11 tested), Google Chrome.

```bash
cd taskpilot
npm install            # installs all workspaces and Playwright's Chromium (postinstall)
copy .env.example .env # optional — every value has a sensible default
```

## 3. Development

```bash
npm run dev            # service in watch mode + extension rebuilt on every change (extension/dist)
npm start              # just the service (tsx, from source)
npm run typecheck      # service + extension + tests, strict TypeScript
```

After an extension rebuild, click ↻ on the TaskPilot card in `chrome://extensions`.

## 4. Build

```bash
npm run build          # automation-server/dist/main.js (bundled) + extension/dist (loadable extension)
node automation-server/dist/main.js      # or: npm run start:prod -w automation-server
```

## 5. Load the extension in Chrome

1. `npm run build -w extension` (or `npm run build`).
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick `taskpilot/extension/dist`.
4. Click the TaskPilot toolbar icon. The dashboard opens in a tab.
5. With the service running, click **Pair extension**. The background worker also pairs automatically.

The manifest carries a fixed public key, so the extension ID is always `eapcdbeffkgfkipnobpkcniohiokgejg`,
wherever the folder lives. Pairing survives reloads. To pin it, set `TASKPILOT_EXTENSION_ID=eapcdbeffkgfkipnobpkcniohiokgejg` in `.env`.

## 6. Local automation service

```bash
npm start                      # http://127.0.0.1:47400 — leave it running
npm run autostart:install      # Windows: start hidden at every sign-in (Task Scheduler, no admin), and start now
npm run autostart:status       # / autostart:uninstall
npm run pair:reset             # forget the paired extension + rotate the token (service stopped)
```

- **Data:** `data/taskpilot.sqlite`, browser profiles in `data/accounts/<platform>/<accountId>/browser-profile`, and the vault fallback in `data/secrets/`.
- **Logs:** `logs/YYYY-MM-DD/<platform>/<accountId>/<task>/<RUN-id>.log` plus screenshots, and `logs/service.log`.
- **Passwords:** Windows Credential Manager, service `taskpilot`. Never in the DB, the extension, extension storage, localStorage, logs or git.
- **Port:** 47400 by default, so it can run next to the older Naukri Tasker on 47321. If you change `PORT`, also change the Service URL in Settings.

### First steps in the extension
1. Under **Settings**, set your name. The dashboard greets you with it.
2. Go to **Accounts → Add account → Naukri**, then **Connect**. A visible browser opens once for sign-in or OTP; the session is then reused.
3. Under **Platforms → Naukri → Resume**, choose the resume folder.
4. Under **Share Interest**, review the limits. Every share is a real job application.
5. Under **Schedules**, use a preset, for example *Hourly 7 AM–11 PM, random minute*.

### Migrating from Naukri Tasker (naukri-auto-updater)
The import copies accounts with their stored passwords, the logged-in browser sessions, resume folders, the headline
baseline, settings, the full Share Interest history (so no role is applied to twice) and the schedules. The schedules arrive **disabled**.
```bash
npm run import:naukri-tasker -- --from "C:\Users\<you>\Desktop\Extension\naukri-auto-updater"          # dry run
npm run import:naukri-tasker -- --from "C:\Users\<you>\Desktop\Extension\naukri-auto-updater" --apply  # TaskPilot service stopped
```
Then turn off the old service (`npm run autostart:uninstall` in the old folder) before you enable the schedules in TaskPilot.

## 7. Testing

```bash
npm run test:unit      # Vitest — 118 unit/service tests (~6 s)
npm run test:e2e       # Playwright — 42 browser tests against the mock Naukri and LinkedIn sites (~2 min; build the extension first)
npm test               # both
```
No test touches the live naukri.com, linkedin.com or your real keychain. Details: [docs/TESTING.md](docs/TESTING.md).

## 8. Security summary
- Listens on `127.0.0.1` only.
- Host-header check (blocks DNS rebinding) and CORS for `chrome-extension://` origins only.
- Extension pairing plus a bearer token (constant-time compare) for every route and the WebSocket.
- Zod validation on every input.
- Passwords are stored only in the OS keychain (or an AES-256-GCM vault), are masked in every log, and are never returned by the API. Usernames are masked.
- OTP and CAPTCHA are never bypassed. Background runs stop with *Action required*; **Connect** finishes the step in a visible window.
- No stealth plugins or user-agent spoofing.
