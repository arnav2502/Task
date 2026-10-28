import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { addNaukriAccount, createEnv, logsOf, makeTempDir, taskOf, waitForRun, writePdf, type TestEnv } from '../helpers/env';

/**
 * The production Naukri adapter, executor and queue driving a real Chromium against the mock Naukri
 * site (tests/mock), whose DOM mirrors the live site. Never touches naukri.com.
 */
let env: TestEnv;
test.afterEach(async () => env?.close());

const run = async (taskType: string, accountId: string, mode?: 'headless' | 'headed') => {
  const r = env.services.executor.enqueue({ taskId: taskOf(env, accountId, taskType).id, trigger: 'manual', mode });
  return waitForRun(env, r.id);
};

test.describe('Naukri login and session', () => {
  test('logs in once, then reuses the persistent session', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'Personal', 'me@example.com');
    const first = await waitForRun(env, env.services.executor.enqueue({ accountId: a.id, systemTask: 'TEST_LOGIN', trigger: 'manual' }).id);
    expect(first.status, logsOf(env, first.id)).toBe('success');
    expect(logsOf(env, first.id)).toContain('Logged in; session saved');
    expect(env.services.accounts.get(a.id).status).toBe('connected');

    const second = await waitForRun(env, env.services.executor.enqueue({ accountId: a.id, systemTask: 'TEST_LOGIN', trigger: 'manual' }).id);
    expect(logsOf(env, second.id)).toContain('Session valid — reusing saved login');
    expect(env.mock!.loginAttempts).toEqual(['me@example.com']);
  });

  test('logs in again when the server-side session expired', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'Personal', 'me@example.com');
    await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    env.mock!.expireAllSessions();
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r.status, logsOf(env, r.id)).toBe('success');
    expect(env.mock!.loginAttempts).toHaveLength(2);
  });

  test('wrong password → INVALID_CREDENTIALS, not retried, account marked login_failed, password never logged', async () => {
    env = await createEnv({ settings: { maxRetries: 2 } });
    env.mock!.addUser('me@example.com', 'the-real-one');
    const a = await env.services.accounts.create({ platformId: 'naukri', name: 'P', username: 'me@example.com', password: 'Wrong#Pass9' });
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r).toMatchObject({ status: 'failed', errorCode: 'INVALID_CREDENTIALS', attempt: 1 });
    expect(r.error).toContain('Invalid details');
    expect(env.services.accounts.get(a.id).status).toBe('login_failed');
    const file = fs.readFileSync(env.services.db.runs.get(r.id)!.logPath!, 'utf8');
    expect(file + logsOf(env, r.id)).not.toContain('Wrong#Pass9');
    expect(env.services.db.notifications.list()[0]).toMatchObject({ type: 'ERROR' });
  });

  test('OTP in a background/unattended run pauses: action_required, ACTION_REQUIRED notification, no bypass', async () => {
    env = await createEnv({ mock: { requireOtp: true } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r).toMatchObject({ status: 'action_required', errorCode: 'OTP_REQUIRED' });
    expect(r.error).toContain('Connect');
    expect(env.services.accounts.get(a.id).status).toBe('action_required');
    expect(env.services.db.notifications.list().find((n) => n.type === 'ACTION_REQUIRED')).toBeTruthy();
    expect(env.mock!.user('me@example.com').headline.endsWith('.')).toBe(false);
  });

  test('OTP in a visible (headed) run waits for the person, then continues the task', async () => {
    test.skip(!!process.env.CI, 'needs a desktop for a headed browser');
    env = await createEnv({ mock: { requireOtp: true, autoCompleteOtpAfterMs: 2500 } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id, 'headed');
    expect(r.status, logsOf(env, r.id)).toBe('success');
    expect(logsOf(env, r.id)).toContain('Verification completed');
  });

  test('headless preflight: a blocked headless browser fails fast and never touches the saved session', async () => {
    env = await createEnv({ mock: { blockHeadless: true } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id, 'headless');
    expect(r).toMatchObject({ status: 'failed', errorCode: 'NAUKRI_HEADLESS_BLOCKED' });
    expect(env.mock!.loginAttempts).toHaveLength(0);
    expect(fs.readdirSync(env.services.accounts.profileDir(a))).toHaveLength(0);
  });
});

test.describe('Naukri Profile Update', () => {
  test('toggles the marker on the Resume headline, verified after reload', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const original = env.mock!.user('me@example.com').headline;

    const r1 = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r1.status, logsOf(env, r1.id)).toBe('success');
    expect(r1.resultMessage).toContain('added');
    expect(env.mock!.user('me@example.com').headline).toBe(`${original}.`);

    const r2 = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r2.resultMessage).toContain('removed');
    expect(env.mock!.user('me@example.com').headline).toBe(original);

    const details = env.services.dashboard.runDetails(r2.id);
    expect(details.timeline.map((t) => `${t.stage}:${t.state}`)).toEqual([
      'STARTED:done',
      'LOGIN_CHECK:done',
      'TASK_EXECUTION:done',
      'VERIFICATION:done',
      'COMPLETED:done',
    ]);
    expect(details.hasScreenshot).toBe(true);
    expect(fs.existsSync(env.services.db.runs.get(r2.id)!.screenshotPath!)).toBe(true);
    expect(env.services.tasks.view(taskOf(env, a.id).id)).toMatchObject({ successCount: 2, lastStatus: 'success' });
  });

  test('uses a custom marker from the task configuration', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    env.services.tasks.update(taskOf(env, a.id).id, { configuration: { marker: ' |' } });
    await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(env.mock!.user('me@example.com').headline.endsWith(' |')).toBe(true);
  });

  test('a save Naukri does not persist fails verification and is retried', async () => {
    env = await createEnv({ mock: { dropHeadlineSave: true }, settings: { maxRetries: 1 } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    expect(r).toMatchObject({ status: 'failed', errorCode: 'NAUKRI_PROFILE_NOT_VERIFIED', attempt: 2 });
    expect(r.error).toBe('FAILED - PROFILE CHANGE NOT VERIFIED');
  });
});

test.describe('Naukri Resume Upload', () => {
  test('uploads the newest PDF (platform default folder) and verifies name + today’s date', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const dir = makeTempDir('resumes');
    writePdf(dir, 'Old_Resume.pdf', new Date(2026, 0, 1));
    writePdf(dir, 'Arnav_Resume_2026.pdf', new Date());
    env.services.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.RESUME_UPLOAD, { folderPath: dir });
    const r = await run(NAUKRI_TASKS.RESUME_UPLOAD, a.id);
    expect(r.status, logsOf(env, r.id)).toBe('success');
    expect(r.resultMessage).toBe('Resume uploaded: Arnav_Resume_2026.pdf');
    expect(env.mock!.user('me@example.com').resumeName).toBe('Arnav_Resume_2026.pdf');
  });

  test('a per-account folder overrides the platform default', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const shared = makeTempDir('shared');
    const own = makeTempDir('own');
    writePdf(shared, 'Shared.pdf', new Date());
    writePdf(own, 'Mine.pdf', new Date(2026, 0, 1));
    env.services.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.RESUME_UPLOAD, { folderPath: shared });
    env.services.tasks.update(taskOf(env, a.id, NAUKRI_TASKS.RESUME_UPLOAD).id, { configuration: { folderPath: own } });
    expect((await run(NAUKRI_TASKS.RESUME_UPLOAD, a.id)).resultMessage).toBe('Resume uploaded: Mine.pdf');
  });

  test('no PDF → fails fast without opening a browser; too large → refused', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const empty = makeTempDir('empty');
    env.services.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.RESUME_UPLOAD, { folderPath: empty });
    const r = await run(NAUKRI_TASKS.RESUME_UPLOAD, a.id);
    expect(r).toMatchObject({ status: 'failed', errorCode: 'NAUKRI_RESUME_NOT_FOUND', attempt: 1, hasScreenshot: false });
    expect(env.mock!.loginAttempts).toHaveLength(0);

    writePdf(empty, 'Huge.pdf', new Date(), 3 * 1024 * 1024);
    expect((await run(NAUKRI_TASKS.RESUME_UPLOAD, a.id)).errorCode).toBe('NAUKRI_RESUME_TOO_LARGE');
  });

  test('an upload Naukri does not keep fails verification', async () => {
    env = await createEnv({ mock: { dropResumeSave: true }, settings: { retryEnabled: false } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const dir = makeTempDir('resumes');
    writePdf(dir, 'New.pdf', new Date());
    env.services.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.RESUME_UPLOAD, { folderPath: dir });
    expect((await run(NAUKRI_TASKS.RESUME_UPLOAD, a.id)).errorCode).toBe('NAUKRI_UPLOAD_NOT_VERIFIED');
  });
});

test.describe('Naukri queue, logs and health check', () => {
  test('two accounts run in parallel; each keeps its own browser profile and session', async () => {
    env = await createEnv({ mock: { profileDelayMs: 600 }, settings: { maxConcurrent: 2 } });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const b = await addNaukriAccount(env, 'B', 'b@example.com');
    const [ra, rb] = await Promise.all([run(NAUKRI_TASKS.PROFILE_UPDATE, a.id), run(NAUKRI_TASKS.PROFILE_UPDATE, b.id)]);
    expect([ra.status, rb.status]).toEqual(['success', 'success']);
    const overlap = Date.parse(ra.startedAt!) < Date.parse(rb.completedAt!) && Date.parse(rb.startedAt!) < Date.parse(ra.completedAt!);
    expect(overlap).toBe(true);
    expect(env.services.accounts.profileDir(a)).not.toBe(env.services.accounts.profileDir(b));
  });

  test('writes a timestamped log file per run with the stage markers', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const r = await run(NAUKRI_TASKS.PROFILE_UPDATE, a.id);
    const file = env.services.db.runs.get(r.id)!.logPath!;
    expect(file).toContain(path.join('naukri', a.id, 'profile-update'));
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(new RegExp(`RUN STARTED  ${r.id}`));
    for (const marker of ['▶ STARTED', '▶ LOGIN CHECK', '▶ TASK EXECUTION', '▶ VERIFICATION', '▶ SUCCESS', 'RESULT: SUCCESS']) expect(text).toContain(marker);
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] /m);
  });

  test('Validate selectors finds every element read-only (nothing saved)', async () => {
    env = await createEnv();
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const before = env.mock!.user('me@example.com').headline;
    const r = await waitForRun(env, env.services.executor.enqueue({ accountId: a.id, systemTask: 'VALIDATE', trigger: 'manual' }).id);
    expect(r.status, logsOf(env, r.id)).toBe('success');
    const checks = r.result!.checks as Array<{ key: string; found: boolean }>;
    expect(checks).toHaveLength(11);
    expect(checks.filter((c) => !c.found)).toEqual([]);
    expect(env.mock!.user('me@example.com').headline).toBe(before);
  });
});
