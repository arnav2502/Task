import type { Page } from 'playwright';
import type { ProfileUpdateConfig } from '@shared/types/naukri.js';
import { findVisible, waitVisible } from '../../../browser/locate.js';
import type { ExecutionContext, TaskResult } from '../../base/platformAdapter.js';
import { naukriError } from '../errors.js';
import { naukriUrls, S, signals } from '../selectors.js';
import type { NaukriStore } from '../store.js';
import { sameText, toggleUpdateMarker } from '../toggleMarker.js';

const quote = (s: string) => (s.length > 60 ? `"…${s.slice(-50)}"` : `"${s}"`);

export async function readHeadline(page: Page): Promise<string> {
  return (await (await waitVisible(page, S.headline.display, 20_000)).innerText()).trim();
}

/**
 * Profile Update: READ → CHECK MARKER → ADD/REMOVE → SAVE → VERIFY (after a reload).
 * Only the Resume headline changes; no other profile section is opened or edited.
 */
export async function updateProfile(page: Page, baseUrl: string, ctx: ExecutionContext, store: NaukriStore): Promise<TaskResult> {
  const { marker } = ctx.config as unknown as ProfileUpdateConfig;

  ctx.step('Opening profile');
  if (!page.url().startsWith(naukriUrls(baseUrl).profile)) await page.goto(naukriUrls(baseUrl).profile, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, S.headline.widget, 30_000);

  ctx.step('Reading the Resume headline');
  await (await waitVisible(page, S.headline.editButton)).click();
  const textarea = await waitVisible(page, S.headline.textarea, 15_000);
  const before = (await textarea.inputValue()).trim();
  if (!before) throw naukriError('HEADLINE_EMPTY', 'The Resume headline is empty — nothing to toggle. Add a headline on Naukri first.');
  ctx.log.info(`Current headline (${before.length} chars) ends with ${quote(before)}`);

  const toggle = toggleUpdateMarker(before, { marker, baseline: store.markerBaseline(ctx.account.id) });
  ctx.log.info(toggle.action === 'added' ? `Marker absent — adding "${marker}"` : `Marker present — removing "${marker}"`);
  const maxLength = Number((await textarea.getAttribute('maxlength')) ?? 250) || 250;
  if (toggle.next.length > maxLength) {
    throw naukriError('HEADLINE_TOO_LONG', `The updated headline would be ${toggle.next.length} characters; Naukri allows ${maxLength}.`);
  }

  ctx.step('Updating the headline');
  await textarea.fill(toggle.next);
  if ((await textarea.inputValue()) !== toggle.next) throw naukriError('SAVE_FAILED', 'Could not write the new headline into the editor');

  ctx.step('Saving');
  const apiOk = page
    .waitForResponse((r) => signals.api.headlineSave.test(r.url()) && r.request().method() !== 'GET', { timeout: 20_000 })
    .then((r) => r.ok())
    .catch(() => null);
  const form = await waitVisible(page, S.headline.form);
  await (await waitVisible(form, S.headline.save)).click();

  // success toast | field validation error | error toast
  const deadline = Date.now() + 20_000;
  let confirmed = false;
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    const toast = await findVisible(page, S.toast.success);
    if (toast && signals.text.headlineSaved.test(await toast.locator.innerText())) {
      confirmed = true;
      ctx.log.success('Naukri confirmed: "Resume Headline has been successfully saved."');
      break;
    }
    const fieldErr = await findVisible(page, S.headline.fieldError);
    const fieldErrText = fieldErr ? (await fieldErr.locator.innerText()).trim() : '';
    if (fieldErrText) throw naukriError('HEADLINE_REJECTED', `Naukri rejected the headline: ${fieldErrText}`);
    const errToast = await findVisible(page, S.toast.error);
    if (errToast) throw naukriError('SAVE_FAILED', `Naukri reported an error: ${(await errToast.locator.innerText()).trim()}`);
    await page.waitForTimeout(250);
  }
  if (!confirmed) {
    if ((await apiOk) === true) ctx.log.warn('No success toast, but the save request returned 200 — verifying');
    else throw naukriError('SAVE_FAILED', 'No save confirmation from Naukri within 20 s');
  }

  ctx.stage('VERIFICATION');
  ctx.step('Reloading the profile to verify');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitVisible(page, S.headline.widget, 30_000);
  const after = await readHeadline(page);
  if (!sameText(after, toggle.next)) {
    ctx.log.error(`Expected ${quote(toggle.next)} but the profile shows ${quote(after)}`);
    throw naukriError('PROFILE_NOT_VERIFIED', 'FAILED - PROFILE CHANGE NOT VERIFIED');
  }
  store.setMarkerBaseline(ctx.account.id, toggle.baseline);
  ctx.log.success(`Verified — the headline now ends with ${quote(after)}`);
  return {
    message: toggle.action === 'added' ? `Profile updated (marker "${marker}" added)` : `Profile updated (marker "${marker}" removed)`,
    data: { action: toggle.action, length: after.length },
  };
}

/** Read-only: open the headline drawer (for validation) … */
export async function peekHeadlineEditor(page: Page): Promise<void> {
  await (await waitVisible(page, S.headline.editButton)).click();
  await waitVisible(page, S.headline.textarea, 10_000);
}

/** … and close it without saving. */
export async function closeHeadlineEditor(page: Page): Promise<void> {
  const cancel = await findVisible(page, S.headline.cancel);
  if (cancel) await cancel.locator.click();
  else await page.keyboard.press('Escape');
}
