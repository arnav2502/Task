import type { Page } from 'playwright';
import { NAUKRI_MAX_RESUME_BYTES, type ResumeFileInfo } from '@shared/types/naukri.js';
import { findVisible, waitVisible } from '../../../browser/locate.js';
import type { ExecutionContext, TaskResult } from '../../base/platformAdapter.js';
import { naukriError } from '../errors.js';
import { naukriUrls, S, signals } from '../selectors.js';

export interface ResumeState {
  fileName: string | null;
  uploadedOn: Date | null;
  uploadedOnText: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse "Uploaded on Oct 14, 2026" (also "14 Oct 2026" and "Today"). */
export function parseUploadedOn(text: string | null, now = new Date()): Date | null {
  if (!text) return null;
  if (/\btoday\b/i.test(text)) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) return new Date(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()), Number(m[2]));
  m = text.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (m && MONTHS.includes(m[2]!.toLowerCase())) return new Date(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()), Number(m[1]));
  return null;
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const normaliseFileName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export async function readResumeState(page: Page): Promise<ResumeState> {
  const nameHit = await findVisible(page, S.resume.fileName);
  const dateHit = await findVisible(page, S.resume.uploadedOn);
  const fileName = nameHit ? ((await nameHit.locator.getAttribute('title')) ?? (await nameHit.locator.innerText())).trim() : null;
  const uploadedOnText = dateHit ? (await dateHit.locator.innerText()).trim() : null;
  return { fileName, uploadedOnText, uploadedOn: parseUploadedOn(uploadedOnText) };
}

/**
 * Resume Upload: open profile → set the file on the real input → wait for Naukri's confirmation →
 * reload → verify the shown file name AND that "Uploaded on" is today. The file is uploaded under
 * its real name (Naukri displays the uploaded file's name).
 */
export async function uploadResume(page: Page, baseUrl: string, ctx: ExecutionContext, file: ResumeFileInfo): Promise<TaskResult> {
  if (file.sizeBytes > NAUKRI_MAX_RESUME_BYTES) {
    throw naukriError('RESUME_TOO_LARGE', `${file.name} is ${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB; Naukri accepts up to 2 MB.`);
  }
  ctx.step('Opening the resume section');
  if (!page.url().startsWith(naukriUrls(baseUrl).profile)) await page.goto(naukriUrls(baseUrl).profile, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, S.resume.widget, 30_000);
  const before = await readResumeState(page);
  ctx.log.info(`Current resume on Naukri: ${before.fileName ?? '(none)'}${before.uploadedOnText ? ` — ${before.uploadedOnText}` : ''}`);

  ctx.step(`Uploading ${file.name}`);
  ctx.log.info(`Uploading ${file.name} (${Math.round(file.sizeBytes / 1024)} KB)`);
  const input = await waitVisible(page, S.resume.fileInput, 15_000, { attachedOnly: true });
  const apiOk = page
    .waitForResponse((r) => signals.api.resumeSave.test(r.url()) && r.request().method() !== 'GET', { timeout: 60_000 })
    .then((r) => r.ok())
    .catch(() => null);
  await input.setInputFiles(file.path);

  ctx.step('Waiting for the upload to finish');
  const box = await waitVisible(page, S.resume.messageBox, 10_000, { attachedOnly: true });
  const deadline = Date.now() + 60_000;
  let confirmed = false;
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    const text = (await box.innerText().catch(() => '')).trim();
    if (signals.text.resumeUploaded.test(text)) {
      confirmed = true;
      ctx.log.success('Naukri confirmed: "Resume has been successfully uploaded."');
      break;
    }
    if (text && /error|fail|invalid|not supported|exceed/i.test(text)) {
      throw naukriError('UPLOAD_FAILED', `Naukri rejected the upload: ${text.replace(/\s+/g, ' ')}`, { retryable: false });
    }
    await page.waitForTimeout(300);
  }
  if (!confirmed) {
    if ((await apiOk) === true) ctx.log.warn('No confirmation message, but the upload request returned 200 — verifying');
    else throw naukriError('UPLOAD_FAILED', 'No upload confirmation from Naukri within 60 s');
  }

  ctx.stage('VERIFICATION');
  ctx.step('Reloading the profile to verify');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitVisible(page, S.resume.widget, 30_000);
  await waitVisible(page, S.resume.fileName, 15_000);
  const after = await readResumeState(page);
  const nameOk = after.fileName !== null && normaliseFileName(after.fileName) === normaliseFileName(file.name);
  const dateOk = after.uploadedOn !== null && sameDay(after.uploadedOn, new Date());
  if (!nameOk || !dateOk) {
    ctx.log.error(`Expected "${file.name}" uploaded today; the profile shows "${after.fileName ?? '?'}" (${after.uploadedOnText ?? 'no date'})`);
    throw naukriError('UPLOAD_NOT_VERIFIED', 'Resume upload could not be verified');
  }
  ctx.log.success(`Verified — ${after.fileName}, ${after.uploadedOnText}`);
  return { message: `Resume uploaded: ${file.name}`, data: { file: file.name, sizeBytes: file.sizeBytes, previous: before.fileName } };
}
