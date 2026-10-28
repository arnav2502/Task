import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { countVisibleBrowserWindows } from '../../automation-server/src/browser/windowControl';
import { addNaukriAccount, createEnv, logsOf, taskOf, type TestEnv } from '../helpers/env';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('in-page role reading works under tsx (the service runtime)', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'tests/fixtures/readCardsUnderTsx.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
  });
  const cards = JSON.parse(out) as Array<{ jobId: string; title: string; skills: string[] }>;
  expect(cards).toHaveLength(5);
  expect(cards[0]).toMatchObject({ jobId: '190826901155', title: 'QA Engineer', skills: ['API Testing', 'Selenium', 'Java'] });
});

test.describe('Background mode', () => {
  let env: TestEnv;
  test.afterEach(async () => env?.close());

  test('runs a real browser with no visible window (Windows)', async () => {
    test.skip(process.platform !== 'win32' || !!process.env.CI, 'window hiding is Windows-only and needs a desktop');
    env = await createEnv({ settings: { defaultMode: 'background' } });
    const a = await addNaukriAccount(env, 'P', 'me@example.com');
    const profileDir = env.services.accounts.profileDir(a);
    const run = env.services.executor.enqueue({ taskId: taskOf(env, a.id, NAUKRI_TASKS.PROFILE_UPDATE).id, trigger: 'schedule' });
    expect(run.mode).toBe('background');
    let maxVisible = 0;
    let samples = 0;
    while (['queued', 'running'].includes(env.services.db.runs.get(run.id)!.status)) {
      if (env.services.browsers.openCount > 0) {
        maxVisible = Math.max(maxVisible, await countVisibleBrowserWindows(profileDir));
        samples++;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const done = env.services.db.runs.get(run.id)!;
    expect(done.status, logsOf(env, run.id)).toBe('success');
    expect(samples).toBeGreaterThan(0);
    expect(maxVisible).toBe(0);
  });
});
