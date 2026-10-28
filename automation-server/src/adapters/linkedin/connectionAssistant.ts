import type { Locator, Page } from 'playwright';
import { LINKEDIN_NOTE_MAX } from '@shared/types/linkedin.js';
import { findVisible, waitVisible } from '../../browser/locate.js';
import { AutomationError } from '../../errors/automationError.js';
import type { ExecutionContext, TaskResult } from '../base/platformAdapter.js';
import { linkedinError } from './errors.js';
import { S, signals } from './selectors.js';
import type { LinkedInStore } from './store.js';

type ProfileState = 'pending' | 'connected' | 'connect' | 'connect_in_menu' | 'unavailable';

async function topCard(page: Page): Promise<Locator> {
  return waitVisible(page, S.profile.topCard, 30_000);
}

async function profileState(page: Page): Promise<ProfileState> {
  const card = await topCard(page);
  if (await findVisible(card, S.profile.pending)) return 'pending';
  if (await findVisible(card, S.profile.connect)) return 'connect';
  const degree = await findVisible(card, S.profile.degree);
  if (degree && /1st/.test(await degree.locator.innerText())) return 'connected';
  if (await findVisible(card, S.profile.more)) return 'connect_in_menu';
  return 'unavailable';
}

/**
 * Send ONE connection request that a person explicitly confirmed (POST …/confirm-connection).
 * Never clicks when LinkedIn already shows "Pending"; marks CONNECTION_SENT only after a reload shows
 * "Pending" (reliable evidence). Weekly limits, email-required members and note limits stop the
 * action with a clear message — nothing is retried or worked around.
 */
export async function sendConnection(page: Page, ctx: ExecutionContext, store: LinkedInStore): Promise<TaskResult> {
  const leadId = Number(ctx.payload?.leadId);
  const lead = Number.isFinite(leadId) ? store.lead(leadId) : null;
  const draft = lead ? store.activeDraft(lead.id) : null;
  if (!lead) throw linkedinError('LEAD_NOT_FOUND', 'This lead no longer exists in TaskPilot.');
  if (!draft || draft.status !== 'confirmed') {
    throw linkedinError('LEAD_NOT_FOUND', 'There is no confirmed connection request for this lead — confirm it again from Connection Drafts.');
  }
  const note = draft.note?.trim() ? draft.note.trim().slice(0, LINKEDIN_NOTE_MAX) : null;
  const fail = (err: AutomationError) => {
    store.setDraftStatus(draft.id, 'failed', { error: err.message });
    store.setStatus(lead.id, 'FAILED', 'SEND_FAILED', err.message, ctx.runId, err.message);
    return err;
  };

  try {
    ctx.step(`Opening ${lead.name}'s profile`);
    await page.goto(lead.profileUrl, { waitUntil: 'domcontentloaded' });
    if (signals.loginUrl.test(page.url())) throw new AutomationError('SESSION_EXPIRED', 'LinkedIn signed you out. Click "Connect" to sign in again, then retry.');
    let state = await profileState(page);
    ctx.log.info(`Profile state: ${state}`);

    if (state === 'pending') {
      ctx.log.success('LinkedIn already shows "Pending" — the request was sent before; not sending again');
      store.setDraftStatus(draft.id, 'sent', { runId: ctx.runId });
      store.setStatus(lead.id, 'CONNECTION_SENT', 'SENT', 'Already pending on LinkedIn', ctx.runId);
      return { message: `Connection request to ${lead.name} was already pending`, data: { leadId: lead.id, alreadyPending: true } };
    }
    if (state === 'connected') {
      store.setDraftStatus(draft.id, 'skipped', { error: 'Already connected' });
      store.setStatus(lead.id, 'CONNECTED', 'ALREADY_CONNECTED', '1st-degree connection', ctx.runId);
      return { message: `${lead.name} is already a connection`, data: { leadId: lead.id, alreadyConnected: true } };
    }

    const card = await topCard(page);
    ctx.step('Opening the invitation');
    if (state === 'connect') {
      await (await waitVisible(card, S.profile.connect)).click();
    } else if (state === 'connect_in_menu') {
      await (await waitVisible(card, S.profile.more)).click();
      const item = await findVisible(page, S.profile.connectInMenu);
      if (!item) state = 'unavailable';
      else await item.locator.click();
    }
    if (state === 'unavailable') {
      throw linkedinError('CONNECT_UNAVAILABLE', `LinkedIn doesn't offer "Connect" for ${lead.name} (it may be follow-only). Open the profile to connect manually.`);
    }

    const dialog = await waitVisible(page, S.invite.dialog, 15_000);
    // Short timeout: the dialog closes after sending, and a closed dialog must not stall the verification.
    const dialogText = async () => (await dialog.innerText({ timeout: 1000 }).catch(() => '')).replace(/\s+/g, ' ');
    if (signals.text.weeklyLimit.test(await dialogText())) {
      throw linkedinError('INVITE_LIMIT', 'LinkedIn says you reached the weekly invitation limit. Try again next week — TaskPilot will not work around it.');
    }
    if ((await findVisible(dialog, S.invite.emailField)) || signals.text.emailRequired.test(await dialogText())) {
      throw linkedinError('EMAIL_REQUIRED', `LinkedIn needs ${lead.name}'s email address to connect. Open the profile to connect manually.`);
    }

    if (note) {
      ctx.step('Adding your note');
      await (await waitVisible(dialog, S.invite.addNote, 10_000)).click();
      await page.waitForTimeout(500);
      const field = await findVisible(page, S.invite.noteField);
      if (!field || signals.text.noteLimit.test(await dialogText())) {
        throw linkedinError('NOTE_NOT_ALLOWED', 'LinkedIn did not allow a note (free accounts have a monthly limit). Remove the note and confirm again, or try later.');
      }
      await field.locator.fill(note);
      if ((await field.locator.inputValue()) !== note) throw linkedinError('NOTE_NOT_ALLOWED', 'Could not type the note into LinkedIn’s invitation box.');
      ctx.step('Sending (you confirmed this request)');
      await (await waitVisible(page, S.invite.send, 10_000)).click();
    } else {
      ctx.step('Sending without a note (you confirmed this request)');
      const without = await findVisible(dialog, S.invite.sendWithoutNote);
      await (without?.locator ?? (await waitVisible(page, S.invite.send, 10_000))).click();
    }

    // Evidence: "Pending" on the top card, then again after a reload.
    ctx.stage('VERIFICATION');
    ctx.step('Verifying the request was sent');
    const deadline = Date.now() + 15_000;
    let seen = false;
    while (Date.now() < deadline && !seen) {
      ctx.throwIfCancelled();
      const toast = await findVisible(page, S.invite.toast);
      const toastText = toast ? await toast.locator.innerText().catch(() => '') : '';
      if (signals.text.weeklyLimit.test(toastText) || signals.text.weeklyLimit.test(await dialogText())) {
        throw linkedinError('INVITE_LIMIT', 'LinkedIn says you reached the weekly invitation limit. Try again next week.');
      }
      seen = !!(await findVisible(await topCard(page), S.profile.pending));
      if (!seen) await page.waitForTimeout(400);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    if ((await profileState(page)) !== 'pending') {
      throw linkedinError('CONNECTION_NOT_CONFIRMED', 'LinkedIn did not confirm the request (the profile does not show "Pending"). Open the profile to check.');
    }
    store.setDraftStatus(draft.id, 'sent', { runId: ctx.runId });
    store.setStatus(lead.id, 'CONNECTION_SENT', 'SENT', note ? 'Sent with a note' : 'Sent without a note', ctx.runId);
    ctx.log.success(`Connection request sent to ${lead.name} — LinkedIn shows "Pending"`);
    return { message: `Connection request sent to ${lead.name}${note ? ' with a note' : ''}`, data: { leadId: lead.id, withNote: !!note } };
  } catch (err) {
    if (err instanceof AutomationError && err.category !== 'CANCELLED') throw fail(err);
    // Cancelled / crashed mid-way: the outcome is unknown, so keep it confirmed — the next attempt re-checks "Pending" first.
    throw err;
  }
}
