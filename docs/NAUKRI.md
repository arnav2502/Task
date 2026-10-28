# Naukri module

The first production platform. Adapter: [`automation-server/src/adapters/naukri/`](../automation-server/src/adapters/naukri/).

| File | Role |
|---|---|
| `descriptor.ts` | Platform descriptor, task types, config fields, Zod config schemas, schedule presets, notes |
| `naukriAdapter.ts` | `PlatformAdapter` implementation: headless preflight, resume fail-fast, session, tasks, validation, metrics, routes |
| `selectors.ts` | **Every** Naukri selector, with ordered fallback candidates |
| `session.ts` | Session check, login, OTP / CAPTCHA pause, manual sign-in fallback for Connect |
| `tasks/profileUpdate.ts` · `tasks/resumeUpload.ts` · `tasks/shareInterest.ts` | The three tasks |
| `toggleMarker.ts` · `resumeFiles.ts` | Pure logic (marker toggle with baseline; PDF folder scan) |
| `store.ts` | Naukri tables `naukri_shared_jobs`, `naukri_profile_state` and their migration |
| `routes.ts` | `/platforms/naukri/*`: resume scan, shared-jobs history, reset headline baseline |
| `errors.ts` | Naukri error codes on top of the generic model |

## Tasks

| Task type | What it does | Effect | Retries | Config (platform default + per-account override) |
|---|---|---|---|---|
| `PROFILE_UPDATE` | Toggles a marker at the end of the **Resume headline**, so the profile reads "updated today". Reload → verify | update | yes | `marker` (default `.`) |
| `RESUME_UPLOAD` | Uploads the newest or a chosen PDF from a folder. Reload → verify the file name **and** today's date | update | yes | `folderPath`, `selectionMode` (`latest`/`specific`), `specificFile` |
| `SHARE_INTEREST` | Clicks "Share interest" on Early access roles, one at a time, randomised, with pauses. **This is a job application** | apply | **never** (no double applications) | `rolesPerRun` 5, `dailyLimit` 25, `includeKeywords`, `excludeKeywords`, `minDelaySec` 25, `maxDelaySec` 75 |

Every account also gets the generic **Connect**, **Test login** and **Validate selectors**. Validation is read-only: it opens
the headline editor and cancels.

Schedule presets: *Daily 9:00 AM*, *Hourly 7 AM–11 PM random minute* (Profile Update); *Daily 9:30 AM*, *Weekdays 10 AM*
(Resume Upload); *Hourly 9 AM–9 PM random minute* (Share Interest).

Dashboard metrics: Profile updates today, Resume uploads today, and Applications today (from `naukri_shared_jobs`).

## Errors

| Code | Category | Retry | When |
|---|---|---|---|
| `NAUKRI_HEADLESS_BLOCKED` | TASK_FAILED | no | Headless preflight got 403. The session was not touched |
| `NAUKRI_HEADLINE_EMPTY` / `_TOO_LONG` / `_REJECTED` | TASK_FAILED | no | Headline missing, over 250 characters, or rejected by Naukri's validation |
| `NAUKRI_SAVE_FAILED` | TASK_FAILED | yes | No save confirmation |
| `NAUKRI_PROFILE_NOT_VERIFIED` | TASK_FAILED | yes | After a reload the headline is not what was saved |
| `NAUKRI_RESUME_NOT_FOUND` / `_TOO_LARGE` | TASK_FAILED | no | No folder or PDF, or the file is over 2 MB. Raised before any browser opens |
| `NAUKRI_UPLOAD_FAILED` / `_NOT_VERIFIED` | TASK_FAILED | yes | No confirmation, or the reload shows a different file or date |
| `NAUKRI_SHARE_FAILED` | TASK_FAILED | no | Every attempted role failed |
| generic `INVALID_CREDENTIALS`, `AUTH_REQUIRED`, `OTP_REQUIRED`, `CAPTCHA_REQUIRED`, `SESSION_EXPIRED`, `PLATFORM_BLOCKED`, `ELEMENT_NOT_FOUND`, `TIMEOUT` | | | Login and page level |

## Share Interest rules
- Roles already **shared or failed** for the account are never tried again. Failed roles usually need manual answers.
- Roles skipped as *no longer listed* may be tried later.
- Include and exclude keywords match title, company and skills, case-insensitively.
- At most `rolesPerRun` roles per run, stopping at `dailyLimit` successful shares per day.
- The success check uses the per-role code in `multiApplyResp`, not the HTTP status (Naukri can answer HTTP 200 with a per-role 409).
- History is kept permanently and survives log retention.

## Migrating from Naukri Tasker
`npm run import:naukri-tasker -- --from "<old folder>" [--apply]`: see the [README](../README.md#migrating-from-naukri-tasker-naukri-auto-updater).

---

# Live-site reference (carried over from Naukri Tasker)

## 1. Login flow

| Item | Observed |
|---|---|
| URL | `https://www.naukri.com/nlogin/login` |
| Form | `form#loginForm` (`name="loginForm"`) |
| Username | `input#usernameField`, placeholder "Enter Email ID / Username" |
| Password | `input#passwordField`, placeholder "Enter Password" |
| Submit | `button[type=submit].blue-btn`, text "Login". A second submit button, "Use OTP to Login" (`.otpButton`), sits in the same form. It is excluded on purpose. |
| Labels | `span.lbl` (not `<label>`), so `getByLabel` can't be used. The selectors use id, then placeholder, then CSS. |
| Bad credentials | `div.commonErrorMsg` shows "Invalid details. Please check the Email ID - Password combination." The URL stays on `/nlogin/login`. |
| Success | The page leaves `/nlogin/…`. When the login page was opened with `?URL=…` it redirects back to that URL. |

**Unauthenticated access:** `GET /mnjuser/profile` returns `302 → /nlogin/login?URL=//www.naukri.com/mnjuser/profile`. A single navigation is therefore enough to tell whether a session is valid.

**Session persistence:** after login Naukri sets these cookies:
- `nauk_at`, `nauk_rt`, `nauk_sid`, `nauk_ps`, `nauk_otl`, `is_login`, `MYNAUKRI[UNID]`
- the Akamai cookies `ak_bmsc`, `bm_sv`, `bm_mi`

They persist on disk in a Playwright **persistent context**, one per account under `data/accounts/naukri/<id>/browser-profile/`. Later runs open that profile and land on the profile page already logged in. This was verified live: after the first login, every later run logged "Session valid — reusing saved login".

**OTP / CAPTCHA:** no OTP was requested for this account from this machine. The automation still checks after each step for these signs:
- an OTP input (`autocomplete=one-time-code`, or `otp` in the id, name, or placeholder)
- a reCAPTCHA or hCaptcha iframe
- a heading such as "Enter OTP" or "Verify your mobile"

If it finds one, it **pauses**. It never tries to solve or bypass the check (see §6).

## 2. Profile update flow (Resume headline)

The text in your example (`Software Test Engineer | Playwright | … | Jira`) is Naukri's **Resume headline** widget. The subtitle under your name on the profile card is a different field (designation/title, with no pipes), and the automation never edits it. No other section is opened: name, phone, email, skills, experience, education, salary, location, and profile summary are all left alone.

| Step | Element |
|---|---|
| Widget | `div#lazyResumeHead.resumeHeadline` |
| Current text | `#lazyResumeHead .widgetCont .prefill` |
| Edit button | `span.edit.icon[role=button][aria-label="Edit resume headline"]`, resolved by **accessible role and name** first |
| Drawer | `.lightbox.profileEditDrawer.resumeHeadlineEdit`. The class changes `flipClose` → `model_open flipOpen` when it opens. |
| Form | `form[name="resumeHeadlineForm"]` |
| Field | `textarea#resumeHeadlineTxt` (`name="resumeHeadline"`, `maxlength="250"`). The hint says "Minimum 5 words". |
| Validation error | `span#resumeHeadlineTxt_err` |
| Save | `form[name=resumeHeadlineForm] button[type=submit]`, text "Save" |
| Cancel | `a.cancel-btn` |
| Save request | `POST /cloudgateway-mynaukri/resman-aggregator-services/v1/users/self/fullprofiles` → 200 |
| Confirmation | Toast `div.msgBox.success[role=status]` containing `p.head` "Success" and `p.msg` "**Resume Headline has been successfully saved.**" The drawer goes back to `flipClose`. |

The `?action=modalOpen` URL you mentioned renders the normal profile page. No modal was visible in our session, so the automation opens the editor with the pencil button instead.

### Marker toggle

`toggleUpdateMarker()` in `automation-server/src/adapters/naukri/toggleMarker.ts`:

- Marker absent → append it: `… | Jira` → `… | Jira.`
- Marker present → remove one copy: `… | Jira.` → `… | Jira`
- Only the end of the text changes. Trailing whitespace is ignored.
- **Real trailing punctuation:** after the first successful run, the description without the marker is stored as the account's `markerBaseline`. From then on the toggle compares against the baseline, not the last character. A headline that genuinely ends in `.` then alternates `Text.` ⇄ `Text..` and never loses its own period. If you edit the headline by hand, the baseline is re-learned. You can reset it with "Re-learn headline baseline" on the Profile Update task (Naukri page).
- The marker is configurable in the Profile Update task configuration (default `.`).
- If the new text would exceed the field's `maxlength` (250), the run fails with `NAUKRI_HEADLINE_TOO_LONG` before anything is saved.

### Verification

READ (textarea value) → CHECK MARKER → ADD/REMOVE → `fill()` → SAVE → wait for the success toast. The `fullprofiles` 200 response is a secondary signal only. Then **reload** the page and read `.prefill` again. The run passes only if the reloaded text equals the expected text, ignoring whitespace differences. Otherwise the result is `FAILED - PROFILE CHANGE NOT VERIFIED`, which is retryable.

## 3. Resume upload flow

| Step | Element |
|---|---|
| Widget | `div#lazyAttachCV` (heading "Resume") |
| Current file | `#lazyAttachCV .resume-name-inline .truncate` (`title` holds the full name, e.g. `Arnav_Chiddarwar_2026 .pdf`) |
| Upload date | `#lazyAttachCV .updateOn`, e.g. "Uploaded on Oct 14, 2026" |
| File input | `input#attachCV[type=file][aria-label="Upload resume"]`. The visible "Update resume" button is a `.dummyUpload` decoy. `setInputFiles` goes straight to the real input. |
| Limits | "Supported Formats: doc, docx, rtf, pdf, upto 2 MB". The automation uploads **PDF only** and rejects files over 2 MB before opening a browser. |
| Requests | `POST https://filevalidation.naukri.com/file`, then `POST /cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/<profileId>` → 200 |
| Confirmation | `span#attachCVMsgBox` gets `div.msgBox.success` containing "Success" and "**Resume has been successfully uploaded.**" The box clears after about 6 seconds. |

**Verification:** after the confirmation, reload the page. Two checks must pass:
1. the displayed file name equals the uploaded file name (case- and whitespace-insensitive);
2. the "Uploaded on" date is **today**.

Otherwise the result is `NAUKRI_UPLOAD_NOT_VERIFIED`, which is retryable.

**Naming note:** Naukri shows the *uploaded file's name*. When we downloaded the resume during exploration, Naukri served it as `Resume.pdf`. Re-uploading under that name changed the displayed name, so we re-uploaded under the original name. The automation always uploads the file from your folder exactly as it is named.

## 3b. Share Interest flow (Early access roles)

Captured live on 15 Oct 2026 and verified end to end with the production code: 1 role was shared and confirmed, in Background (hidden) mode.

| Step | Observed |
|---|---|
| Page | `https://www.naukri.com/mnjuser/recommended-earjobs`, header `p.lp__heading-label` ("74 Early access roles from top companies"). Also linked from `/mnjuser/performance`. |
| Card | `div.tuple-list-container > div.tlc__tuple[data-job-id]`. Contents: title `a.title`, company `.comp-name`, experience `.exp`, salary `.sal`, location `.loc`, skills `ul.tags-gt li.tag-li` |
| Button | `button.unshared`, text "Share interest" |
| Paging | All roles are in the DOM at once. There is no pagination. |
| Click | `POST /cloudgateway-workflow/workflow-services/apply-workflow/v1/apply` with body `{"strJobsarr":["<jobId>"],"applytype":"single"}`. **This is an application.** |
| Confirmation | The browser navigates to `/myapply/saveApply?strJobsarr=[<id>]&multiApplyResp={"<id>":200}…`, where `span.apply-message` shows "**Interest shared successfully!**" |
| After sharing | The listing still shows "Share interest" for that role. Naukri doesn't mark it, so shared roles are tracked locally in the `naukri_shared_jobs` table and never shared twice. |

How a run works:
1. Open the listing and read every card.
2. Drop roles that were already shared, apply the include/exclude keywords, and shuffle the rest.
3. Share at most *roles per run*, and stop at the *daily limit*.
4. For each role:
   - scroll it into view and wait 1–3.5 s;
   - hover and click;
   - confirm via the per-role code in `multiApplyResp` plus the success message;
   - record the result;
   - wait a fresh random 25–75 s (configurable) before the next role.

A per-role code other than 200 is recorded as **failed**, even if the HTTP call itself returned 200. A role that leads to a different page (for example, extra questions) is also marked failed, and the run moves on. Shared-role history is kept permanently: it is tiny, and it is what prevents duplicate applications. The 24-hour log cleanup doesn't touch it.

Runtime note: the role list is read with an in-page script sent as plain text. The service runs under `tsx` (esbuild `keepNames`), which injects a `__name` helper into compiled callbacks, and that helper doesn't exist inside the page. `tests/e2e/runtime.spec.ts` guards against this.

## 4. Browser modes and bot protection

| Mode | Live result |
|---|---|
| Headed (bundled Chromium or Chrome) | ✅ 200, full functionality |
| **Background** (headed Chromium, window hidden from desktop and taskbar on Windows; minimized elsewhere) | ✅ 200, full functionality. All live runs used this mode; a live check found 0 visible windows during the runs. |
| Headless (old headless shell, `chromium` new headless, `chrome` headless) | ❌ **HTTP 403 "Access Denied"** from Naukri's edge (Akamai), on both the login and profile pages |

In one test, a blocked headless visit made with a logged-in profile **invalidated the session**: the next headed visit was logged out. For that reason:

- **Background** is the default mode for scheduled runs. It is a real headed browser whose window is hidden (Windows: off-screen at launch, then `ShowWindow(SW_HIDE)` on the windows of that profile's processes only). Naukri sees exactly what it sees in Headed mode; there are no fingerprint changes.
- **Headless** is still offered, as requested. Before touching the account's profile it runs a **preflight** from a throwaway, cookie-less context. If that preflight is blocked, the run fails with `NAUKRI_HEADLESS_BLOCKED` and the saved session is never exposed. The result is cached for 15 minutes.
- No user-agent spoofing, stealth plugins, or other evasion are used. Those would be the "anti-bot bypass" this project explicitly excludes.

## 5. Selector strategy

Each element has an ordered list of candidates: **id → role/name → label/placeholder → text → CSS → XPath** (XPath is used only as a last-resort container lookup). `locate.ts` uses the first candidate that is visible, or attached for file inputs. When none match, the error names the element and every candidate tried, so a UI change is quick to diagnose:

```
SELECTOR_NOT_FOUND: Could not find "Resume headline edit (pencil) button" on the page
(tried role=button[name=Edit resume headline], css=#lazyResumeHead .widgetHead .edit, …)
```

When Naukri changes its UI:
1. Run **Accounts → Validate selectors** (read-only) to see which elements are missing.
2. Inspect the live page in a headed run and add or reorder candidates in `selectors.ts`.
3. Run `npm test`. The mock site in `tests/mock` mirrors the live DOM, so update it too if the structure really changed.

## 6. Safety

- CAPTCHA, OTP, and bot checks are never bypassed. On detection:
  - **Headed/Background** runs bring the window to the front and wait up to *Manual verification wait* (Settings, default 5 min) for you to finish. Then they continue.
  - **Headless** runs stop with `needs_verification`. Click **Connect** on the account to finish in a visible window.
- Passwords are read from the OS credential store only at the moment of login, typed into Naukri's form, and never logged. Playwright tracing is off.

## 7. Known limitations

- **Headless is blocked by Naukri today.** Use Background mode for unattended runs.
- **Background mode hides the window only on Windows.** On macOS/Linux it starts minimized, so a dock/taskbar entry appears briefly during a run.
- **OTP-on-login was not triggered during exploration**, so its exact markup wasn't observed. Detection is heuristic (§1) and covered by tests against a simulated OTP page. If Naukri's real OTP page isn't detected, the run fails with a clear "Could not determine the login state" message, and **Connect** still lets you log in manually in the visible window.
- **One run per account at a time.** A browser profile can only be opened by one browser, so jobs for the same account are queued. Different accounts run in parallel up to *Maximum concurrent accounts*.
- **Validation runs through the queue.** Validate selectors waits until the account has no other job, because a browser profile can be opened only once.
- **Upload date resolution is one day.** Re-uploading the same file twice in one day is verified by file name; the date check passes because it is still "today".
