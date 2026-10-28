/**
 * Runs readRoleCards() under tsx — the runtime the service actually uses — against the mock site.
 * esbuild's keepNames injects a `__name` helper into compiled callbacks that does not exist inside
 * the page; the in-page script must be plain text to survive that. Prints the cards as JSON.
 */
import { chromium } from 'playwright';
import { readRoleCards } from '../../automation-server/src/adapters/naukri/tasks/shareInterest.js';
import { MockNaukri } from '../mock/mockNaukri.js';

const mock = new MockNaukri();
const base = await mock.start();
mock.addUser('me@example.com', 'x');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/mnjuser/recommended-earjobs', async (route) => {
    const { earJobsHtml, DEFAULT_ROLES } = await import('../mock/mockNaukri.js');
    await route.fulfill({ contentType: 'text/html', body: earJobsHtml(DEFAULT_ROLES) });
  });
  await page.goto(`${base}/mnjuser/recommended-earjobs`);
  process.stdout.write(JSON.stringify(await readRoleCards(page)));
} finally {
  await browser.close();
  await mock.stop();
}
