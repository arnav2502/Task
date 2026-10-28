import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { attachWebSocket, createApp } from '../../automation-server/src/server/app';
import { addNaukriAccount, createEnv, makeTempDir, type TestEnv } from '../helpers/env';

/**
 * Integration: the built extension (extension/dist) driving the real service over HTTP + WebSocket.
 * Run `npm run build -w extension` first; the test is skipped when the build is missing.
 */
const DIST = path.resolve(import.meta.dirname, '../../extension/dist');
const SHOTS = process.env.TASKPILOT_SCREENSHOTS;

let env: TestEnv;
let server: http.Server;
let context: BrowserContext;

test.skip(!fs.existsSync(path.join(DIST, 'manifest.json')), 'extension not built');

test.beforeEach(async () => {
  env = await createEnv({ settings: { displayName: 'Arnav', setupComplete: true } });
  const { app, token } = createApp(env.services);
  server = http.createServer(app);
  attachWebSocket(server, env.services, token);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;

  context = await chromium.launchPersistentContext(makeTempDir('chrome'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  type ChromeGlobal = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
  await worker.evaluate((url) => (globalThis as unknown as ChromeGlobal).chrome.storage.local.set({ serviceUrl: url }), `http://127.0.0.1:${port}`);
});

test.afterEach(async () => {
  await context?.close();
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  await env?.close();
});

async function openApp(hash = '#/dashboard') {
  const worker = context.serviceWorkers()[0]!;
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/index.html${hash}`);
  // First open: pair (the background worker may already have done it).
  const pairButton = page.getByRole('button', { name: /pair extension/i });
  if (await pairButton.isVisible({ timeout: 3000 }).catch(() => false)) await pairButton.click();
  return { page, errors, id };
}

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

test('pairs with the service and renders the dashboard with every platform', async () => {
  const a = await addNaukriAccount(env, 'Personal Naukri', 'arnav.test@example.com');
  env.services.scheduler.create({ taskId: env.services.db.tasks.list({ accountId: a.id })[0]!.id, frequency: 'daily', time: '09:00' });
  const { page, errors } = await openApp();
  await expect(page.getByText(/Good (morning|afternoon|evening), Arnav/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Here's what's happening with your automations.")).toBeVisible();
  for (const name of ['Naukri', 'LinkedIn', 'Indeed', 'Glassdoor', 'Career Portals']) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Coming soon').first()).toBeVisible();
  await expect(page.getByText('Connected').first()).toBeVisible();
  await shot(page, 'dashboard');
  expect(env.services.db.settings.getKv('pairedExtensionId')).toMatch(/^[a-p]{32}$/);
  expect(errors).toEqual([]);
});

test('Platforms: Naukri is active and opens its control center; the rest are Coming soon', async () => {
  const { page, errors } = await openApp('#/platforms');
  await expect(page.getByText('LinkedIn').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'platforms');
  await page.goto(page.url().replace(/#.*/, '#/platforms/naukri'));
  await expect(page.getByText('Resume', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Share Interest', { exact: true }).first()).toBeVisible();
  await shot(page, 'naukri');
  expect(errors).toEqual([]);
});

test('runs a task from the UI and shows it live in Execution History with its details', async () => {
  await addNaukriAccount(env, 'Personal Naukri', 'arnav.test@example.com');
  const { page, errors } = await openApp('#/tasks');
  const card = page.getByText('Profile Update', { exact: true }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await shot(page, 'tasks');
  await page.getByRole('button', { name: 'Run now' }).first().click();
  await expect.poll(() => env.services.db.runs.list({}).runs[0]?.status, { timeout: 60_000 }).toBe('success');
  const runId = env.services.db.runs.list({}).runs[0]!.id;
  await page.goto(page.url().replace(/#.*/, `#/history/${runId}`));
  await expect(page.getByText(runId).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/RESULT: SUCCESS/).first()).toBeVisible();
  await shot(page, 'run-details');
  expect(errors).toEqual([]);
});

test('accounts page never shows the full username or the password', async () => {
  await addNaukriAccount(env, 'Personal Naukri', 'arnav.test@example.com', 'Sup3r#Secret');
  const { page } = await openApp('#/accounts');
  await expect(page.getByText('Personal Naukri').first()).toBeVisible({ timeout: 15_000 });
  const html = await page.content();
  expect(html).not.toContain('arnav.test@example.com');
  expect(html).not.toContain('Sup3r#Secret');
  await expect(page.getByText('arna******@example.com').first()).toBeVisible();
  await shot(page, 'accounts');
});

test('switches between dark and light themes and remembers the choice', async () => {
  const a = await addNaukriAccount(env, 'Personal Naukri', 'arnav.test@example.com');
  await env.services.executor.waitFor(env.services.executor.enqueue({ taskId: env.services.db.tasks.list({ accountId: a.id })[0]!.id, trigger: 'manual' }).id, 60_000);
  const { page, errors } = await openApp('#/dashboard');
  await expect(page.getByText(/Good (morning|afternoon|evening), Arnav/)).toBeVisible({ timeout: 15_000 });
  const theme = page.getByRole('radiogroup', { name: 'Theme' }).first();
  await theme.getByRole('radio', { name: /Light/ }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(244, 246, 250)');
  await shot(page, 'light-dashboard');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  for (const [hash, name] of [['#/platforms', 'light-platforms'], ['#/tasks', 'light-tasks'], ['#/history', 'light-history'], ['#/settings', 'light-settings']]) {
    await page.goto(page.url().replace(/#.*/, hash!));
    await page.waitForTimeout(800);
    await shot(page, name!);
  }
  await page.getByRole('radiogroup', { name: 'Theme' }).first().getByRole('radio', { name: /Dark/ }).click();
  await expect(page.locator('html')).not.toHaveClass(/light/);
  expect(errors).toEqual([]);
});
