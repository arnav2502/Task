# LinkedIn module — Lead Finder + Connection Assistant

**TaskPilot finds and prepares; you decide.** The LinkedIn module helps you search for people (recruiters, hiring
managers, founders …), keeps a de-duplicated lead list, and prepares connection requests with an optional note.

A connection request is sent **only** when you press **Confirm & Send** on one lead. It is never sent by the scheduler, never in
bulk, and never silently.

> LinkedIn's User Agreement restricts automated access. TaskPilot keeps the footprint small and visible:
> - it runs in your own signed-in browser;
> - it reads a few results per run (default 20, max 50);
> - it never stores your LinkedIn password (you sign in yourself with **Connect**);
> - it uses no stealth, proxy, CAPTCHA or limit bypass;
> - a person confirms every request.
>
> Use it at your own discretion.

## Workflow

```
Lead Finder wizard (name → search → filters → action → note → run now / schedule)
  → generic multi-instance task  (task type LEAD_FINDER, e.g. "Find QA Recruiters")
  → run: open LinkedIn people search → read ≤ maxLeads cards → filter → de-duplicate → upsert leads
         → prepare ≤ maxCandidates connection drafts → run ends WAITING_FOR_REVIEW
  → notification "24 leads found · 8 ready for review" [Review now]
  → Connection Drafts: edit note / skip / Confirm & Send (one lead at a time)
  → SEND_CONNECTION run (user-confirmed action): open profile → Connect → note → Send → verify "Pending"
  → lead CONNECTION_SENT (only with evidence) → history
```

## Task states (generic)
`DRAFT` (created, never run, no schedule) · `SCHEDULED` · `RUNNING` · `WAITING_FOR_REVIEW` (last run prepared items still pending) ·
`COMPLETED` · `FAILED` · `CANCELLED`.

## Lead statuses
`NEW` → `REVIEWED` / `SELECTED` / `SKIPPED` → `READY_FOR_CONNECTION` (draft prepared) → `CONNECTION_CONFIRMED` (you pressed Confirm & Send; queued) →
`CONNECTION_SENT` (LinkedIn shows *Pending* after sending) · `CONNECTED` (1st degree) · `FAILED`.

## Duplicate protection
Leads are unique per LinkedIn account by **profile reference** (the `/in/<slug>` path). A lead found again is updated
(`last_seen_at`, headline, location) and keeps its status. Skipped, connected and already-sent leads never become
candidates again.

## API (all under `/platforms/linkedin`, bearer token required)

| Method & path | Body / query | Response |
|---|---|---|
| `GET /stats` | `?accountId=` | `LinkedInStats` |
| `GET /tasks` | | `LinkedInTaskStats[]` (join with generic `GET /tasks?platformId=linkedin`) |
| `GET /tasks/:taskId` | | `LinkedInTaskStats & { searches: LinkedInSearch[] }` |
| `GET /searches` | `?taskId=&limit=` | `LinkedInSearch[]` |
| `GET /leads` | `?status=&taskId=&accountId=&q=&limit=&offset=` | `LeadListResponse` |
| `GET /leads/:id` | | `Lead & { draft: ConnectionDraft \| null; actions: Array<{ action, detail, runId, createdAt }> }` |
| `POST /leads/:id/review` | | `Lead` (NEW → REVIEWED) |
| `POST /leads/:id/select` | | `Lead` (→ SELECTED) |
| `POST /leads/:id/skip` | | `Lead` (→ SKIPPED, pending draft → skipped) |
| `POST /leads/bulk` | `{ ids: number[], action: 'review' \| 'select' \| 'skip' }` | `{ updated }`. **No bulk send.** |
| `POST /leads/:id/connection-draft` | `{ note: string \| null }` | `ConnectionDraft` (lead → READY_FOR_CONNECTION) |
| `POST /leads/:id/confirm-connection` | `{ confirm: true, note?: string \| null }` | `202 ExecutionRun` (the SEND_CONNECTION run). Explicit user action only |
| `GET /connection-drafts` | `?status=pending&taskId=` | `ConnectionDraft[]` |

Generic routes used by the module:
- `POST /tasks` `{ accountId, taskType: 'LEAD_FINDER', name, configuration }` creates a named task.
- `PUT /tasks/:id` `{ name?, enabled?, configuration? }`.
- `DELETE /tasks/:id` deletes a multi-instance task.
- `POST /tasks/:id/run`, `/schedules`, `/runs`, `/notifications` work as for every platform.

`GET /runs` can return the run status `waiting_for_review`, with `reviewCount`. Notifications carry `link`; for a LinkedIn
review it is `#/platforms/linkedin/drafts`.

## Configuration (`LeadFinderConfig`)
`keywords`, `jobTitles[]`, `locations[]`, `companies[]`, `currentCompany`, `industry`, `schools[]`, `profileKeywords[]`,
`connectionDegree` (`all`/`1st`/`2nd`/`3rd`), `action` (`find_only`/`prepare_connection`/`prepare_with_note`),
`noteMode` (`none`/`same`/`personalized`), `note` (≤ 300 chars; template placeholders `{firstName}` `{name}` `{title}` `{company}`),
`maxLeads` (default 20, max 50) and `maxCandidates` (default 10, max 25).

How the filters are applied:
- **Sent to LinkedIn's people search:** keywords (plus industry), network degree, the company keyword field and the school keyword field.
- **Applied to the result cards:** job titles, locations, current company and profile keywords. LinkedIn's own location and
  industry filters need internal ids, so TaskPilot matches the text on the cards instead.
