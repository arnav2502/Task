# Testing

```bash
npm run test:unit          # Vitest — fast, no real browser
npm run build -w extension # once, for the extension ↔ service tests
npm run test:e2e           # Playwright Test — real Chromium against the mock Naukri site
npm test                   # both
npm run typecheck          # strict TypeScript for service, extension and tests
```

Every test builds an isolated service stack (`tests/helpers/env.ts`):
- a temporary database and logs folder;
- the encrypted-file vault instead of your OS keychain;
- Naukri pointed at the local **mock Naukri site** (`tests/mock/mockNaukri.ts`), whose DOM mirrors the live site so the
  production selectors run unchanged — and LinkedIn at `tests/mock/mockLinkedIn.ts` when a test asks for it.

No test touches naukri.com or linkedin.com.

## Unit / service tests (Vitest, `tests/unit`) — 118 tests

| File | Covers |
|---|---|
| `scheduleMath.test.ts` | once / daily / weekly / specific days / hourly window (fixed and random minute), validation, summaries |
| `scheduler.test.ts` | Firing and `nextRunAt`, missed runs (skip / run after 2–6 min), once self-disables, paused task or account, duplicate → skipped, hourly next slot, "only while Chrome is open" |
| `queue.test.ts` | Concurrency limit, one job per account, priority + FIFO, duplicate keys, cancel (waiting / running), reservations |
| `executor.test.ts` | Run ids, stages, timeline, success bookkeeping, retry of temporary failures, no retry for non-retryable errors or task types, platform error codes, OTP → action_required, timeout, cancellation, 409 duplicates, parallel accounts, retry-as-new-run, invalid config, system tasks |
| `accounts.test.ts` | Task creation, isolated profiles, refusals (coming soon, duplicate, no password), masking, update and keep password, disconnect, delete cascade; **credential security** (no plaintext anywhere on disk, AES-GCM tamper detection, AAD binding, log redaction) |
| `api.test.ts` | Token auth, pairing (first only, pinned id), Host header, CORS, WebSocket auth and live stream, Zod 400s, accounts / tasks / schedules / runs / platforms / notifications endpoints, file-path containment, adapter routes mounted only for active platforms |
| `adapters.test.ts` | Registry loading (1 active, 5 coming soon), registration guards, coming-soon never works, Naukri config validation, **a brand-new adapter working end to end with no core change**, per-scope migrations, platform data cascade |
| `database.test.ts` | Idempotent migrations, settings merge, run-id format, orphan cancellation, retention (keeps Share Interest history), failed timeline |
| `regressions.test.ts` | Code-review fixes: pending Share Interest rows never retried, no browser after an early close, crashed browser = failure, timed-out attempt aborted, hourly start minute, late tick keeps the next slot |
| `linkedin.test.ts` | Search URL, profile reference, headline/degree parsing, filters, note templates (≤300), config validation, lead de-duplication, one active draft per lead, named Lead Finder tasks + states, **actions can never be scheduled**, waiting_for_review + Review-now notification |
| `naukriLogic.test.ts` | Marker toggle and baseline, resume folder scan (latest / specific / >2 MB / missing), "Uploaded on" parsing, apply-code parsing, role selection |

`FakeExecutor` (`tests/helpers/fakeExecutor.ts`) keeps every bit of executor bookkeeping and replaces only the browser work.

## Browser e2e (Playwright Test, `tests/e2e`) — 42 tests

| File | Covers |
|---|---|
| `naukri.spec.ts` | Login then session reuse, expired session, wrong password (not retried, never logged), OTP in background → action_required, OTP in headed → waits and continues, headless 403 preflight, Profile Update toggle + verification + timeline + screenshot, custom marker, unverified save → retried, Resume Upload (platform default, per-account override, fail fast, >2 MB, unverified), parallel accounts, log file format, read-only Validate selectors |
| `shareInterest.spec.ts` | Roles per run, never twice, include / exclude keywords, daily limit, per-role 409 recorded as failed, empty listing, dashboard metric |
| `extension.spec.ts` | The built extension against the real service: pairing, dashboard with every platform, Platforms → Naukri control center, Run now → live Run Details, no full username or password in the page |
| `linkedin.spec.ts` | Lead Finder vs mock LinkedIn: search params, filters, anonymous members ignored, drafts + WAITING_FOR_REVIEW (nothing sent), no duplicates / skipped never re-proposed, find-only, signed-out & security-check messages, Connect sign-in; confirmation: refused without `confirm: true`, exactly one request with the edited note verified by Pending, More-menu Connect, never "People also viewed", already-pending, email-required, follow-only, unconfirmed send, weekly & note limits (no fallback), drafts API without bulk send |
| `extensionLinkedIn.spec.ts` | The built extension: wizard → run → Overview/Leads/Tasks/Drafts → Confirm & Send dialog → exactly one invitation |
| `runtime.spec.ts` | In-page script under tsx (the service runtime); Background mode with **0 visible windows** (Windows) |

Set `TASKPILOT_SCREENSHOTS=<folder>` to save UI screenshots from `extension.spec.ts`.
Headed and Background tests are skipped on CI (`CI=1`), because they need a desktop.
