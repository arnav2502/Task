import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { attachWebSocket, createApp } from '../../automation-server/src/server/app';
import { addLinkedInAccount, createEnv, makeTempDir, type TestEnv } from '../helpers/env';

/**
 * Integration: the built extension driving the LinkedIn module end to end against the real service
 * and the mock LinkedIn site — wizard → run → review → one explicit confirmation → sent.
 */
const DIST = path.resolve(import.meta.dirname, '../../extension/dist');
const SHOTS = process.env.TASKPILOT_SCREENSHOTS;

let env: TestEnv;
let server: http.Server;
let context: BrowserContext;

test.skip(!fs.existsSync(path.join(DIST, 'manifest.json')), 'extension not built');

test.beforeEach(async () => {
  env = await createEnv({ mock: false, linkedin: {}, settings: { displayName: 'Arnav', setupComplete: true } });
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

async function open(hash: string): Promise<{ page: Page; errors: string[] }> {
  const id = new URL(context.serviceWorkers()[0]!.url()).host;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/index.html${hash}`);
  const pair = page.getByRole('button', { name: /pair extension/i });
  if (await pair.isVisible({ timeout: 3000 }).catch(() => false)) await pair.click();
  return { page, errors };
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

test('wizard → run → review → confirm ONE lead → sent; nothing else is sent', async () => {
  await addLinkedInAccount(env);
  const mock = env.linkedin!;
  const { page, errors } = await open('#/platforms/linkedin/finder');

  // Step 1 – name
  await page.getByPlaceholder('Find QA Recruiters').fill('Find Technical Recruiters');
  await page.getByRole('button', { name: /^next$/i }).click();
  // Step 2 – search criteria
  await page.getByPlaceholder('Technical Recruiter', { exact: true }).fill('Technical Recruiter');
  const locations = page.getByPlaceholder('India, Delhi, Bangalore, Remote');
  await locations.fill('India');
  await locations.press('Enter');
  await shot(page, 'li-wizard-search');
  // Remaining steps: keep defaults (2nd degree, prepare connection, no note) and choose "Run now".
  for (let i = 0; i < 8; i++) {
    const runNow = page.getByTitle('Run now').first();
    if (await runNow.isVisible().catch(() => false)) await runNow.click();
    const create = page.getByRole('button', { name: /^create task$/i });
    if (await create.isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: /^next$/i }).click();
  }
  await shot(page, 'li-wizard-review');
  await page.getByRole('button', { name: /^create task$/i }).click();

  await expect
    .poll(() => env.services.db.runs.list({ platformId: 'linkedin' }).runs[0]?.status, { timeout: 90_000 })
    .toBe('waiting_for_review');
  expect(mock.invitations).toEqual([]);

  await page.goto(page.url().replace(/#.*/, '#/platforms/linkedin/overview'));
  await expect(page.getByText('Pending review').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'li-overview');
  await page.goto(page.url().replace(/#.*/, '#/platforms/linkedin/leads'));
  await expect(page.getByText('Rahul Sharma').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'li-leads');
  await page.goto(page.url().replace(/#.*/, '#/platforms/linkedin/tasks'));
  await expect(page.getByText('Find Technical Recruiters').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'li-tasks');

  await page.goto(page.url().replace(/#.*/, '#/platforms/linkedin/drafts'));
  const card = page.locator('li, article, [data-lead-card], div.rounded-xl').filter({ hasText: 'Rahul Sharma' }).filter({ has: page.getByRole('button', { name: /confirm & send/i }) }).last();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await shot(page, 'li-drafts');
  await card.getByRole('button', { name: /confirm & send/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Connect with Rahul Sharma/)).toBeVisible();
  await shot(page, 'li-confirm');
  await dialog.getByRole('button', { name: /send connection request/i }).click();

  await expect.poll(() => mock.invitations.length, { timeout: 60_000 }).toBe(1);
  expect(mock.invitations[0]).toEqual({ slug: 'rahul-sharma-123', note: null });
  await expect.poll(() => env.services.db.runs.list({ taskType: 'SEND_CONNECTION' }).runs[0]?.status, { timeout: 60_000 }).toBe('success');
  await page.waitForTimeout(1500);
  expect(mock.invitations).toHaveLength(1);
  expect(errors).toEqual([]);
});
