# Adding a platform

Adding LinkedIn, Indeed, Glassdoor, Career Portals or a Custom module means adding an adapter. Nothing in the queue,
scheduler, executor, history, notifications, API or generic UI changes. `tests/unit/adapters.test.ts → "Adding a platform"`
proves this with a throwaway `DemoAdapter`.

## 1. Write the adapter

`automation-server/src/adapters/<id>/<id>Adapter.ts`:

```ts
export class LinkedInAdapter extends BasePlatformAdapter {
  readonly descriptor: PlatformDescriptor = {
    id: 'linkedin', name: 'LinkedIn', status: 'active', accent: '#0A66C2', monogram: 'in', /* … */
    capabilities: { requiresLogin: true, browserModes: ['background', 'headed'], defaultMode: 'background',
                    supportsConnect: true, supportsValidation: true },
    tasks: [{
      type: 'CONNECT_PEOPLE', name: 'Connect with people', effect: 'apply', retryable: false,
      description: '…', metricLabel: 'Connection requests',
      configFields: [{ key: 'perRun', label: 'Requests per run', type: 'number', min: 1, max: 20 },
                     { key: 'keywords', label: 'Search keywords', type: 'tags' }],
      defaultConfig: { perRun: 5, keywords: [] },
    }],
    plannedTasks: [], notes: [],
  };
  protected override readonly configSchemas = {
    CONNECT_PEOPLE: z.object({ perRun: z.number().int().min(1).max(20).default(5), keywords: z.array(z.string()).default([]) }),
  };
  override readonly migrations = [/* linkedin_* tables, scope "linkedin" */];

  async checkSession(session, ctx) { /* open a members-only page, classify */ }
  async authenticate(session, ctx) { /* reuse session → login with ctx.credentials() → OTP: throw OTP_REQUIRED unless ctx.interactive */ }
  async executeTask(session, ctx) {
    const page = await session.page();
    // ctx.config is validated; ctx.step('…') shows progress; ctx.stage('VERIFICATION') before verifying;
    // ctx.sleep(ms) is cancellable; throw platformError('linkedin', 'LIMIT_REACHED', 'TASK_FAILED', '…') on failure.
    return { message: 'Sent 5 connection requests', data: { sent: 5 } };
  }
}
```

Guidelines (proven by the Naukri adapter):
- **Selectors:** keep every selector in one `selectors.ts`, with fallback candidates, and resolve them with `browser/locate.ts`.
- **Verification:** verify every change after a reload before reporting success.
- **Retries:** mark side-effecting tasks (applications, messages) `retryable: false`, and record what was done per item in a platform table, so a later run continues instead of repeating.
- **OTP / CAPTCHA:** never solve or bypass them. Pause visibly when `ctx.interactive || ctx.mode === 'headed'`; otherwise throw `OTP_REQUIRED` / `CAPTCHA_REQUIRED`.
- **In-page scripts:** send `page.evaluate` scripts as plain strings, because the service runs under tsx (`__name` helper).

## 2. Register it

In `automation-server/src/adapters/index.ts`, replace `createLinkedInAdapter()` (the coming-soon stub) with `new LinkedInAdapter()`.
Pass a test base URL with `LINKEDIN_BASE_URL` (any `<PLATFORM>_BASE_URL` env var works).

## 3. UI (optional)

The generic UI already gives the new platform:
- a platform card and a control center (Accounts, Tasks with config forms rendered from `configFields`, Schedules);
- dashboard activity and metrics;
- history and notifications.

For platform-specific screens, add an entry to `extension/src/pages/platforms/registry.tsx` (Naukri adds Resume and Share
Interest tabs this way). For platform-specific data, add routes with `routes()`; they are mounted at `/platforms/<id>/…`.

## 4. Test it
Add a mock site under `tests/mock/`, unit tests for pure logic, and e2e specs driving the adapter through the real executor
(see `tests/e2e/naukri.spec.ts`).

---

## Prepared designs

### Career Portal Manager (`career-portals`)
- **Account = a monitored company portal.** `name` = company (e.g. TCS), `username` = career-page URL, no password
  (`capabilities.requiresLogin: false`, already supported by the account service).
- **Task `MONITOR_JOBS`.** Config: `keywords` (QA Engineer, Software Tester, Automation Tester, SDET), `locations` (India, Delhi,
  Pune, Mumbai), `experience` (0-2 years).
- **`executeTask`.** Extracts postings with a per-portal selector profile or a generic job-list extractor, stores them in
  `career_portal_jobs(account_id, job_key, title, location, url, first_seen_at)`, and raises an `INFO` notification
  *"New matching career portal job found"* for each new match. Hourly schedules with a random minute come for free.

### Custom Tasks (`custom`)
- **Account = a website target** (URL, optional login).
- **Task types.** `OPEN_PAGE`, `WATCH_ELEMENT` (notify when an item appears) and `WATCH_TEXT` (notify on a status change).
  Their selector and URL live in the task configuration; the last seen value lives in a `custom_watch_state` table.
