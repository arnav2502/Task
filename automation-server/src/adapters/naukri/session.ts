import type { Page } from 'playwright';
import { AutomationError } from '../../errors/automationError.js';
import { findVisible, waitVisible } from '../../browser/locate.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import type { ExecutionContext } from '../base/platformAdapter.js';
import { naukriUrls, S, signals } from './selectors.js';

export type PageState = 'logged_in' | 'login_page' | 'otp' | 'captcha' | 'blocked' | 'login_error' | 'unknown';

export const VERIFICATION_MESSAGE = 'Manual verification required. Please complete it in the browser.';

export async function isBlockedPage(page: Page): Promise<boolean> {
  try {
    return signals.blockedTitle.test(await page.title());
  } catch {
    return false;
  }
}

/** Classify the current page without waiting. Order matters: block → OTP → CAPTCHA → login → profile. */
export async function detectPageState(page: Page): Promise<PageState> {
  if (await isBlockedPage(page)) return 'blocked';
  if ((await findVisible(page, S.verification.otpInput)) || (await findVisible(page, S.verification.otpHeading))) return 'otp';
  if (await findVisible(page, S.verification.captcha)) return 'captcha';
  if (signals.loginUrl.test(page.url())) {
    const err = await findVisible(page, S.login.error);
    if (err && (await err.locator.innerText()).trim()) return 'login_error';
    return 'login_page';
  }
  if ((await findVisible(page, S.headline.widget)) || (await findVisible(page, S.resume.widget))) return 'logged_in';
  return 'unknown';
}

async function waitForState(page: Page, accept: PageState[], timeoutMs: number, ctx: ExecutionContext): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  let state: PageState = 'unknown';
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    state = await detectPageState(page).catch(() => 'unknown' as PageState);
    if (accept.includes(state)) return state;
    await page.waitForTimeout(400);
  }
  return state;
}

/** Open the profile page: one navigation tells whether the saved session is still valid. */
export async function openAndClassify(page: Page, baseUrl: string, ctx: ExecutionContext): Promise<PageState> {
  const res = await page.goto(naukriUrls(baseUrl).profile, { waitUntil: 'domcontentloaded' });
  if (res?.status() === 403) return 'blocked';
  return waitForState(page, ['logged_in', 'login_page', 'otp', 'captcha', 'blocked'], 25_000, ctx);
}

const verificationError = (state: 'otp' | 'captcha', detail: string) =>
  new AutomationError(state === 'otp' ? 'OTP_REQUIRED' : 'CAPTCHA_REQUIRED', detail);

/**
 * OTP / CAPTCHA: never bypassed. Unattended (background/headless) runs stop with OTP_REQUIRED /
 * CAPTCHA_REQUIRED — they never pop a window up; the user clicks Connect to finish in a visible
 * browser. Visible runs (Connect, headed) wait for the person to complete it.
 */
async function handleVerification(
  state: 'otp' | 'captcha' | 'signin',
  session: AutomationSession,
  page: Page,
  baseUrl: string,
  ctx: ExecutionContext,
) {
  const what = state === 'otp' ? 'OTP verification' : state === 'captcha' ? 'CAPTCHA verification' : 'the sign-in';
  if (state !== 'signin') {
    ctx.log.warn(`${what} required. ${VERIFICATION_MESSAGE}`);
    if (!ctx.interactive && ctx.mode !== 'headed') {
      throw verificationError(state, `Naukri asked for ${what}. Background runs never open a window — click "Connect" on the account to finish it.`);
    }
    ctx.actionRequired(state === 'otp' ? 'OTP_REQUIRED' : 'CAPTCHA_REQUIRED', `Naukri asked for ${what}. Complete it in the open browser window.`);
  }
  await session.revealWindow();
  ctx.step(`Waiting for you to complete ${what}`);
  const waitMs = ctx.settings.verificationWaitSec * 1000;
  ctx.log.info(`Waiting up to ${Math.round(waitMs / 60_000)} min for you to finish…`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await ctx.sleep(2000);
    const current = await detectPageState(page).catch(() => 'unknown' as PageState);
    if (current === 'logged_in') {
      ctx.log.success('Verification completed — session saved');
      return;
    }
    if (current !== 'unknown' || signals.loginUrl.test(page.url()) || signals.verificationUrl.test(page.url())) continue;
    // Left the login / verification flow (e.g. landed on the homepage) — confirm on the profile page.
    if ((await openAndClassify(page, baseUrl, ctx).catch(() => 'unknown')) === 'logged_in') {
      ctx.log.success('Verification completed — session saved');
      return;
    }
  }
  const message = `${what} was not completed within ${Math.round(waitMs / 1000)} s.`;
  throw state === 'signin' ? new AutomationError('AUTH_REQUIRED', message) : verificationError(state, message);
}

async function login(session: AutomationSession, page: Page, baseUrl: string, ctx: ExecutionContext): Promise<void> {
  const creds = await ctx.credentials();
  if (!creds) throw new AutomationError('AUTH_REQUIRED', 'No stored password for this account. Edit the account and enter the password.');

  ctx.step('Logging in with stored credentials');
  if (!signals.loginUrl.test(page.url())) await page.goto(naukriUrls(baseUrl).login, { waitUntil: 'domcontentloaded' });
  const user = await waitVisible(page, S.login.username);
  const pass = await waitVisible(page, S.login.password);
  await user.fill(creds.username);
  await pass.fill(creds.password);
  ctx.log.info('Submitting the login form');
  await (await waitVisible(page, S.login.submit)).click();

  // Leaving /nlogin → logged in · error box → bad credentials · OTP/CAPTCHA → the user.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    const state = await detectPageState(page).catch(() => 'unknown' as PageState);
    if (state === 'login_error') {
      const err = await findVisible(page, S.login.error);
      throw new AutomationError('INVALID_CREDENTIALS', `Login failed: ${err ? (await err.locator.innerText()).trim() : 'rejected by Naukri'}`);
    }
    if (state === 'otp' || state === 'captcha') return handleVerification(state, session, page, baseUrl, ctx);
    if (state === 'blocked') throw new AutomationError('PLATFORM_BLOCKED', 'Naukri returned "Access Denied" during login.');
    if (!signals.loginUrl.test(page.url())) break;
    await page.waitForTimeout(500);
  }

  ctx.step('Verifying login');
  const after = await openAndClassify(page, baseUrl, ctx);
  if (after === 'otp' || after === 'captcha') return handleVerification(after, session, page, baseUrl, ctx);
  if (after !== 'logged_in') throw new AutomationError('SESSION_EXPIRED', 'Login did not complete — still not signed in after submitting the form.');
  ctx.log.success('Logged in; session saved in this account’s browser profile');
}

/**
 * Make sure the account's browser is signed in:
 *   1. reuse the persistent session when valid ("Session valid — reusing saved login");
 *   2. otherwise log in with the password from secure storage;
 *   3. OTP / CAPTCHA → pause for the user, never bypass.
 * Interactive Connect falls back to a manual sign-in in the visible window when auto-login fails.
 */
export async function ensureSession(session: AutomationSession, baseUrl: string, ctx: ExecutionContext): Promise<{ reused: boolean }> {
  const page = await session.page();
  ctx.step('Checking the saved session');
  const state = await openAndClassify(page, baseUrl, ctx);
  if (state === 'logged_in') {
    ctx.log.success('Session valid — reusing saved login');
    ctx.sessionValid(true);
    return { reused: true };
  }
  if (state === 'blocked') throw new AutomationError('PLATFORM_BLOCKED', 'Naukri returned "Access Denied" (HTTP 403). Use Background or Headed mode.');
  if (state === 'otp' || state === 'captcha') {
    await handleVerification(state, session, page, baseUrl, ctx);
    ctx.sessionValid(false);
    return { reused: false };
  }
  if (state !== 'login_page') {
    throw new AutomationError('SESSION_EXPIRED', `Could not determine the login state (landed on ${page.url()})`);
  }
  ctx.log.info('Not signed in (session expired or new account)');
  try {
    await login(session, page, baseUrl, ctx);
  } catch (err) {
    const manualOk = ctx.interactive && err instanceof AutomationError && ['AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'SESSION_EXPIRED'].includes(err.category);
    if (!manualOk) throw err;
    ctx.log.warn(`Automatic login failed (${err.message}). Sign in manually in the open window.`);
    await page.goto(naukriUrls(baseUrl).login, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await handleVerification('signin', session, page, baseUrl, ctx);
  }
  ctx.sessionValid(false);
  return { reused: false };
}
