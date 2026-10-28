import type { Page } from 'playwright';
import type { ShareInterestConfig } from '@shared/types/naukri.js';
import { findVisible } from '../../../browser/locate.js';
import { AutomationError } from '../../../errors/automationError.js';
import type { ExecutionContext, TaskResult } from '../../base/platformAdapter.js';
import { naukriError } from '../errors.js';
import { earlyAccessRoleById, naukriUrls, S, signals } from '../selectors.js';
import type { NaukriStore } from '../store.js';

export interface RoleCard {
  jobId: string;
  title: string;
  company: string | null;
  experience: string | null;
  salary: string | null;
  location: string | null;
  skills: string[];
}

export type Rng = () => number;

const norm = (s: string) => s.toLowerCase();
const cardText = (c: RoleCard) => norm([c.title, c.company ?? '', ...c.skills].join(' | '));

/**
 * Pick roles to share: not attempted before, matching an include keyword (if any), matching no
 * exclude keyword (title, company and skills, case-insensitive), in random order, at most `limit`.
 * Pure — unit tested.
 */
export function selectRoles(cards: RoleCard[], opts: { already: Set<string>; include: string[]; exclude: string[]; limit: number; rng?: Rng }): RoleCard[] {
  const rng = opts.rng ?? Math.random;
  const include = opts.include.map((k) => norm(k.trim())).filter(Boolean);
  const exclude = opts.exclude.map((k) => norm(k.trim())).filter(Boolean);
  const seen = new Set<string>();
  const eligible = cards.filter((c) => {
    if (opts.already.has(c.jobId) || seen.has(c.jobId)) return false;
    seen.add(c.jobId);
    const text = cardText(c);
    if (include.length && !include.some((k) => text.includes(k))) return false;
    return !exclude.some((k) => text.includes(k));
  });
  // Fisher–Yates: random order, like a person scrolling and picking.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
  }
  return eligible.slice(0, Math.max(0, opts.limit));
}

export const randomBetween = (min: number, max: number, rng: Rng = Math.random) => min + rng() * Math.max(0, max - min);

/**
 * Read every card in one pass. The script is sent as plain text on purpose: under tsx/esbuild
 * (keepNames) a compiled callback gets a `__name` helper that does not exist inside the page.
 */
export async function readRoleCards(page: Page): Promise<RoleCard[]> {
  const firstCss = (def: { candidates: Array<{ kind: string; value?: unknown }> }) => String(def.candidates.find((c) => c.kind === 'css')?.value ?? '');
  const sel = {
    tuple: firstCss(S.earlyAccess.tuple),
    title: firstCss(S.earlyAccess.title),
    company: firstCss(S.earlyAccess.company),
    experience: firstCss(S.earlyAccess.experience),
    salary: firstCss(S.earlyAccess.salary),
    location: firstCss(S.earlyAccess.location),
    skills: firstCss(S.earlyAccess.skills),
  };
  const script = `(() => {
    const sel = ${JSON.stringify(sel)};
    return Array.from(document.querySelectorAll(sel.tuple)).map(function (el) {
      function text(q) { var n = el.querySelector(q); return n && n.innerText ? n.innerText.trim() || null : null; }
      return {
        jobId: el.getAttribute('data-job-id') || '',
        title: text(sel.title) || 'Untitled role',
        company: text(sel.company),
        experience: text(sel.experience),
        salary: text(sel.salary),
        location: text(sel.location),
        skills: Array.from(el.querySelectorAll(sel.skills)).map(function (s) { return s.innerText.trim(); }).filter(Boolean)
      };
    });
  })()`;
  return ((await page.evaluate(script)) as RoleCard[]).filter((c) => c.jobId);
}

/** multiApplyResp={"<jobId>":200} from the confirmation URL. */
export function applyResponseCode(url: string, jobId: string): number | null {
  try {
    const raw = new URL(url).searchParams.get('multiApplyResp');
    if (!raw) return null;
    const code = (JSON.parse(raw) as Record<string, unknown>)[jobId];
    return typeof code === 'number' ? code : Number(code) || null;
  } catch {
    return null;
  }
}

const describe = (c: RoleCard) =>
  `${c.title}${c.company ? ` — ${c.company}` : ''}${c.experience || c.location ? ` (${[c.experience, c.location].filter(Boolean).join(', ')})` : ''}`;

async function openListing(page: Page, baseUrl: string, ctx: ExecutionContext): Promise<boolean> {
  await page.goto(naukriUrls(baseUrl).earlyAccessRoles, { waitUntil: 'domcontentloaded' });
  if (signals.loginUrl.test(page.url())) throw new AutomationError('SESSION_EXPIRED', 'Signed out while opening Early access roles');
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    ctx.throwIfCancelled();
    if (await findVisible(page, S.earlyAccess.tuple)) return true;
    if (await findVisible(page, S.earlyAccess.heading)) {
      await page.waitForTimeout(1500);
      return !!(await findVisible(page, S.earlyAccess.tuple));
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Share Interest on Early access roles — on Naukri this IS a job application.
 * One role at a time, like a person: random order, scroll into view, "reading" pause, hover, click,
 * confirm via the per-role code, then a fresh random pause before the next role. Stops at the
 * per-run count and the daily limit. Never retried inside a run (no double applications); progress
 * is recorded per role so the next run simply continues.
 */
export async function shareInterest(page: Page, baseUrl: string, ctx: ExecutionContext, store: NaukriStore, rng: Rng = Math.random): Promise<TaskResult> {
  const cfg = ctx.config as unknown as ShareInterestConfig;
  const accountId = ctx.account.id;
  const result = { found: 0, eligible: 0, shared: 0, failed: 0, skipped: 0 };
  const done = (message: string): TaskResult => ({ message, data: { ...result } });

  ctx.step('Opening Early access roles');
  if (!(await openListing(page, baseUrl, ctx))) {
    ctx.log.info('No Early access roles are listed right now — nothing to share');
    return done('No Early access roles listed right now');
  }
  const cards = await readRoleCards(page);
  result.found = cards.length;
  const already = store.attemptedJobIds(accountId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const remainingToday = Math.max(0, cfg.dailyLimit - store.countSharedSince(accountId, startOfDay.toISOString()));
  const picks = selectRoles(cards, { already, include: cfg.includeKeywords, exclude: cfg.excludeKeywords, limit: Number.MAX_SAFE_INTEGER, rng });
  result.eligible = picks.length;
  ctx.log.info(
    `Found ${cards.length} roles · ${cards.filter((c) => already.has(c.jobId)).length} already attempted · ${picks.length} eligible` +
      `${cfg.includeKeywords.length ? ` (include: ${cfg.includeKeywords.join(', ')})` : ''}` +
      `${cfg.excludeKeywords.length ? ` (exclude: ${cfg.excludeKeywords.join(', ')})` : ''}`,
  );
  if (!remainingToday) {
    ctx.log.warn(`Daily limit reached (${cfg.dailyLimit} today) — nothing more today`);
    return done(`Daily limit reached (${cfg.dailyLimit})`);
  }
  const queue = picks.slice(0, Math.min(cfg.rolesPerRun, remainingToday));
  if (!queue.length) {
    ctx.log.info('Nothing new to share');
    return done(`No new roles to share (${result.found} listed, ${result.eligible} eligible)`);
  }
  ctx.log.info(`Will share ${queue.length} role(s) this run, one by one in random order`);

  for (let i = 0; i < queue.length; i++) {
    const card = queue[i]!;
    if (i > 0) {
      const wait = Math.round(randomBetween(cfg.minDelaySec, cfg.maxDelaySec, rng));
      ctx.step(`Waiting ${wait}s before the next role (${i}/${queue.length} done)`);
      await ctx.sleep(wait * 1000);
      if (!(await openListing(page, baseUrl, ctx))) {
        ctx.log.warn('The Early access list is empty now — stopping');
        break;
      }
    }

    ctx.step(`Sharing interest ${i + 1}/${queue.length}: ${card.title}`);
    const tuple = page.locator(earlyAccessRoleById(card.jobId)).first();
    if (!(await tuple.count())) {
      result.skipped++;
      store.record(accountId, card, 'skipped', 'No longer listed', ctx.runId);
      ctx.log.warn(`Skipped (no longer listed): ${describe(card)}`);
      continue;
    }
    await tuple.scrollIntoViewIfNeeded();
    await ctx.sleep(Math.round(randomBetween(1200, 3500, rng)));
    const btn = await findVisible(tuple, S.earlyAccess.shareButton);
    if (!btn) {
      result.skipped++;
      store.record(accountId, card, 'skipped', 'No "Share interest" button on this card', ctx.runId);
      ctx.log.warn(`Skipped (no Share interest button): ${describe(card)}`);
      continue;
    }
    await btn.locator.hover();
    await ctx.sleep(Math.round(randomBetween(300, 900, rng)));

    // Written BEFORE the click: if the run is cancelled, times out or crashes before the outcome is
    // known, the role stays "pending" and is never applied to again.
    const attemptId = store.record(accountId, card, 'pending', 'Clicked — outcome not confirmed', ctx.runId);
    const applyResp = page
      .waitForResponse((r) => signals.api.shareInterestApply.test(r.url()) && r.request().method() === 'POST', { timeout: 25_000 })
      .then((r) => r.status())
      .catch(() => null);
    await btn.locator.click();

    // Confirmation: /myapply/saveApply?…multiApplyResp={"<id>":200} + "Interest shared successfully!"
    let ok = false;
    let reason = 'No confirmation from Naukri';
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (signals.loginUrl.test(page.url())) throw new AutomationError('SESSION_EXPIRED', 'Signed out while sharing interest');
      const code = applyResponseCode(page.url(), card.jobId);
      const msg = await findVisible(page, S.earlyAccess.successMessage);
      if (msg && signals.text.interestShared.test(await msg.locator.innerText())) {
        ok = code === null || code === 200;
        if (!ok) reason = `Naukri returned status ${code}`;
        break;
      }
      if (code !== null && code !== 200) {
        reason = `Naukri returned status ${code}`;
        break;
      }
      if (!/recommended-earjobs|saveApply/i.test(page.url())) {
        reason = `Naukri opened another page (${new URL(page.url()).pathname}) — this role may need manual answers`;
        break;
      }
      await page.waitForTimeout(300);
    }
    const apiStatus = await applyResp;
    // Fallback only when Naukri gave no per-role result: HTTP 200 can still carry a per-role rejection (e.g. 409).
    if (!ok && applyResponseCode(page.url(), card.jobId) === null && apiStatus === 200 && /saveApply/i.test(page.url())) ok = true;

    if (ok) {
      result.shared++;
      store.settle(attemptId, 'shared', null);
      ctx.log.success(`Interest shared (${result.shared}/${queue.length}): ${describe(card)}`);
    } else {
      result.failed++;
      store.settle(attemptId, 'failed', reason);
      ctx.log.warn(`Could not share: ${describe(card)} — ${reason}`);
    }
  }

  ctx.stage('VERIFICATION');
  ctx.log.info(`Shared ${result.shared}, failed ${result.failed}, skipped ${result.skipped}`);
  if (result.failed && !result.shared) throw naukriError('SHARE_FAILED', `Could not share interest in any role (${result.failed} attempt(s) failed)`);
  return done(
    `Shared interest in ${result.shared} role(s)${result.failed ? `, ${result.failed} failed` : ''}${result.skipped ? `, ${result.skipped} skipped` : ''}`,
  );
}
