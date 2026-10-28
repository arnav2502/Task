import type { Page } from 'playwright';
import { findVisible } from '../../browser/locate.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import { AutomationError } from '../../errors/automationError.js';
import type { ExecutionContext, SessionState } from '../base/platformAdapter.js';
import { linkedinUrls, S, signals } from './selectors.js';

export const SESSION_GONE =
  'LinkedIn session is no longer available. Click "Connect" on the LinkedIn account, sign in to LinkedIn in the window that opens, then retry this task.';

type PageState = 'signed_in' | 'signed_out' | 'challenge' | 'unknown';

export async function classify(page: Page): Promise<PageState> {
  const url = page.url();
  if (signals.challengeUrl.test(url) || (await findVisible(page, S.page.challenge))) return 'challenge';
  if (signals.loginUrl.test(url)) return 'signed_out';
  if (await findVisible(page, S.page.signedIn)) return 'signed_in';
  return 'unknown';
}

async function waitForState(page: Page, ctx: ExecutionContext, timeoutMs: number): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  let state: PageState = 'unknown';
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    state = await classify(page).catch(() => 'unknown' as PageState);
    if (state !== 'unknown') return state;
    await page.waitForTimeout(400);
  }
  return state;
}

export async function checkLinkedInSession(page: Page, base: string, ctx: ExecutionContext): Promise<SessionState> {
  await page.goto(linkedinUrls(base).feed, { waitUntil: 'domcontentloaded' });
  const state = await waitForState(page, ctx, 25_000);
  return state === 'signed_in' ? 'authenticated' : state === 'challenge' ? 'action_required' : state === 'signed_out' ? 'unauthenticated' : 'unknown';
}

/**
 * Make sure the account's browser is signed in to LinkedIn. TaskPilot never types a LinkedIn password:
 * - saved session valid → reuse it;
 * - signed out / security check during an unattended run → stop with a clear message (AUTH_REQUIRED /
 *   CAPTCHA_REQUIRED) — never bypassed;
 * - Connect (interactive) → show the window and wait for the person to sign in or finish the check.
 */
export async function ensureLinkedInSession(session: AutomationSession, base: string, ctx: ExecutionContext): Promise<{ reused: boolean }> {
  const page = await session.page();
  ctx.step('Checking the LinkedIn session');
  const state = await checkLinkedInSession(page, base, ctx);
  if (state === 'authenticated') {
    ctx.log.success('Session valid — reusing your LinkedIn sign-in');
    ctx.sessionValid(true);
    return { reused: true };
  }
  const visible = ctx.interactive || ctx.mode === 'headed';
  if (state === 'action_required') {
    if (!visible) {
      throw new AutomationError(
        'CAPTCHA_REQUIRED',
        'LinkedIn asked for a security verification. Click "Connect" on the LinkedIn account to complete it yourself, then retry.',
      );
    }
    ctx.actionRequired('CAPTCHA_REQUIRED', 'LinkedIn asked for a security verification. Complete it in the open browser window.');
  } else if (!visible) {
    throw new AutomationError(state === 'unauthenticated' ? 'AUTH_REQUIRED' : 'SESSION_EXPIRED', SESSION_GONE);
  }

  // A person is at the screen: show the window and wait for them to sign in / finish the check.
  // The "authwall" / join pages are not a sign-in form: open LinkedIn's own sign-in page.
  if (state !== 'action_required' && !/\/(uas\/)?login/i.test(page.url())) {
    await page.goto(linkedinUrls(base).login, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await session.revealWindow();
  ctx.step('Waiting for you to sign in to LinkedIn');
  ctx.log.info(`Sign in to LinkedIn in the open window. Waiting up to ${Math.round(ctx.settings.verificationWaitSec / 60)} min…`);
  const deadline = Date.now() + ctx.settings.verificationWaitSec * 1000;
  while (Date.now() < deadline) {
    await ctx.sleep(2000);
    const now = await classify(page).catch(() => 'unknown' as PageState);
    if (now === 'signed_in') {
      ctx.log.success('Signed in — session saved in this account’s browser profile');
      ctx.sessionValid(false);
      return { reused: false };
    }
    // Landed somewhere neutral after signing in: confirm on the feed.
    if (now === 'unknown' && !signals.loginUrl.test(page.url()) && (await checkLinkedInSession(page, base, ctx).catch(() => 'unknown')) === 'authenticated') {
      ctx.log.success('Signed in — session saved in this account’s browser profile');
      ctx.sessionValid(false);
      return { reused: false };
    }
  }
  throw new AutomationError('AUTH_REQUIRED', 'LinkedIn sign-in was not completed in time. Click "Connect" to try again.');
}
