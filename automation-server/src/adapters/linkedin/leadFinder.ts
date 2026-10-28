import type { Page } from 'playwright';
import { LINKEDIN_NOTE_MAX, type ConnectionDegree, type Lead, type LeadFinderConfig } from '@shared/types/linkedin.js';
import { findVisible } from '../../browser/locate.js';
import { AutomationError } from '../../errors/automationError.js';
import type { ExecutionContext, TaskResult } from '../base/platformAdapter.js';
import { linkedinError } from './errors.js';
import { linkedinUrls, S, signals } from './selectors.js';
import { CANDIDATE_STATUSES, type LeadCard, type LinkedInStore } from './store.js';

/** LinkedIn shows 10 people per results page; never read more than this many pages in one run. */
const PER_PAGE = 10;
const MAX_PAGES = 5;

const NETWORK: Record<LeadFinderConfig['connectionDegree'], string | null> = { all: null, '1st': 'F', '2nd': 'S', '3rd': 'O' };

/** Build the people-search URL. Free-text filters only (LinkedIn's id-based facets need internal ids). */
export function buildSearchUrl(base: string, cfg: LeadFinderConfig, page = 1): string {
  const u = new URL(linkedinUrls(base).peopleSearch);
  const keywords = [cfg.keywords, cfg.industry].map((x) => x.trim()).filter(Boolean).join(' ');
  if (keywords) u.searchParams.set('keywords', keywords);
  const titles = cfg.jobTitles.filter(Boolean);
  if (titles.length) u.searchParams.set('titleFreeText', titles.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR '));
  const companies = [...cfg.companies, cfg.currentCompany].map((c) => c.trim()).filter(Boolean);
  if (companies.length) u.searchParams.set('company', companies.map((c) => (c.includes(' ') ? `"${c}"` : c)).join(' OR '));
  if (cfg.schools.length) u.searchParams.set('schoolFreeText', cfg.schools.join(' OR '));
  const network = NETWORK[cfg.connectionDegree];
  if (network) u.searchParams.set('network', JSON.stringify([network]));
  u.searchParams.set('origin', 'FACETED_SEARCH');
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

/** "/in/Rahul-Sharma-123/?miniProfileUrn=…" → "/in/rahul-sharma-123". The stable lead identity. */
export function profileReference(href: string): string | null {
  try {
    const path = new URL(href, 'https://www.linkedin.com').pathname;
    const m = /^\/in\/([^/]+)/i.exec(path);
    return m ? `/in/${decodeURIComponent(m[1]!).toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/** "Technical Recruiter at ABC Technologies" → title + company (best effort; headlines are free text). */
export function splitHeadline(headline: string | null): { jobTitle: string | null; company: string | null } {
  if (!headline) return { jobTitle: null, company: null };
  const first = headline.split(/\s[|•·]\s/)[0]!.trim();
  const m = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(first);
  if (m) return { jobTitle: m[1]!.trim() || null, company: m[2]!.trim() || null };
  return { jobTitle: first || null, company: null };
}

export const parseDegree = (text: string | null): ConnectionDegree => {
  const m = /\b(1st|2nd|3rd)\+?/i.exec(text ?? '');
  return m ? (m[1]!.toLowerCase() as ConnectionDegree) : null;
};

interface RawCard {
  href: string;
  name: string;
  headline: string | null;
  location: string | null;
  degree: string | null;
}

/**
 * Read the visible result cards of the current results page (one in-page pass). Sent as plain text so
 * it survives tsx/esbuild's `__name` helper. Uses LinkedIn's result classes, then a structural fallback
 * (lines of each list item that holds a profile link).
 */
async function readCards(page: Page): Promise<RawCard[]> {
  const script = `(() => {
    function clean(t) { return (t || '').replace(/\\s+/g, ' ').trim(); }
    var items = Array.from(document.querySelectorAll('main li')).filter(function (li) { return li.querySelector('a[href*="/in/"]'); });
    return items.map(function (li) {
      var link = li.querySelector('.entity-result__title-text a[href*="/in/"]') || li.querySelector('a[href*="/in/"]');
      var nameEl = link.querySelector('span[aria-hidden="true"]') || link;
      var q = function (sel) { var n = li.querySelector(sel); return n ? clean(n.innerText) : null; };
      var headline = q('.entity-result__primary-subtitle');
      var location = q('.entity-result__secondary-subtitle');
      var degree = q('.entity-result__badge-text');
      if (!headline) {
        var lines = (li.innerText || '').split('\\n').map(clean).filter(function (l) {
          return l && !/^(view .* profile|connect|message|follow|pending|•?\\s*(1st|2nd|3rd\\+?))$/i.test(l) && !/^status is /i.test(l);
        });
        var nm = clean(nameEl.innerText);
        var rest = lines.filter(function (l) { return l !== nm && l.indexOf(nm) !== 0; });
        headline = rest[0] || null;
        location = location || rest[1] || null;
      }
      if (!degree) { var d = /\\b(1st|2nd|3rd)\\+?/.exec(li.innerText || ''); degree = d ? d[0] : null; }
      return { href: link.getAttribute('href') || '', name: clean(nameEl.innerText), headline: headline, location: location, degree: degree };
    });
  })()`;
  return (await page.evaluate(script)) as RawCard[];
}

export function toLeadCard(raw: RawCard, base: string): LeadCard | null {
  const ref = profileReference(raw.href);
  const name = raw.name.trim();
  // Out-of-network results show "LinkedIn Member" without a profile — nothing to act on.
  if (!ref || !name || /^linkedin member$/i.test(name)) return null;
  const { jobTitle, company } = splitHeadline(raw.headline);
  return {
    profileReference: ref,
    profileUrl: new URL(ref, base).toString(),
    name,
    headline: raw.headline,
    jobTitle,
    company,
    location: raw.location,
    connectionDegree: parseDegree(raw.degree),
  };
}

const has = (text: string | null | undefined, words: string[]) => {
  const t = (text ?? '').toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
};

/** Apply the card-level filters. Pure — unit tested. */
export function filterLeads(cards: LeadCard[], cfg: LeadFinderConfig): LeadCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (seen.has(c.profileReference)) return false;
    seen.add(c.profileReference);
    const profileText = [c.headline, c.jobTitle, c.company].filter(Boolean).join(' | ');
    if (cfg.jobTitles.length && !has(profileText, cfg.jobTitles)) return false;
    if (cfg.locations.length && !has(c.location, cfg.locations)) return false;
    if (cfg.currentCompany.trim() && !has(profileText, [cfg.currentCompany.trim()])) return false;
    if (cfg.profileKeywords.length && !has(profileText, cfg.profileKeywords)) return false;
    if (cfg.connectionDegree !== 'all' && c.connectionDegree && c.connectionDegree !== cfg.connectionDegree) return false;
    return true;
  });
}

/** Fill a note template for one lead; the result never exceeds LinkedIn's 300-character limit. */
export function renderNote(template: string, lead: Pick<Lead, 'name' | 'jobTitle' | 'company'>): string {
  const firstName = lead.name.split(/\s+/)[0] ?? lead.name;
  const out = template
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{name\}/g, lead.name)
    .replace(/\{title\}/g, lead.jobTitle ?? 'your role')
    .replace(/\{company\}/g, lead.company ?? 'your company')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  return out.length > LINKEDIN_NOTE_MAX ? `${out.slice(0, LINKEDIN_NOTE_MAX - 1).trimEnd()}…` : out;
}

/** Open the people search and read at most `maxLeads` cards (a few pages, with reading pauses). */
export async function searchLeads(page: Page, base: string, ctx: ExecutionContext, cfg: LeadFinderConfig): Promise<LeadCard[]> {
  const cards: LeadCard[] = [];
  const pages = Math.min(MAX_PAGES, Math.ceil(cfg.maxLeads / PER_PAGE));
  for (let p = 1; p <= pages && cards.length < cfg.maxLeads; p++) {
    if (p > 1) await ctx.sleep(2000 + Math.round(Math.random() * 2000));
    ctx.step(`Reading search results (page ${p})`);
    const res = await page.goto(buildSearchUrl(base, cfg, p), { waitUntil: 'domcontentloaded' });
    if (signals.loginUrl.test(page.url())) throw new AutomationError('SESSION_EXPIRED', 'LinkedIn signed you out while searching. Click "Connect" to sign in again, then retry.');
    if (signals.challengeUrl.test(page.url())) throw new AutomationError('CAPTCHA_REQUIRED', 'LinkedIn asked for a security verification. Click "Connect" to complete it yourself.');
    if (res && res.status() >= 500) throw linkedinError('SEARCH_UNAVAILABLE', `LinkedIn search is unavailable right now (HTTP ${res.status()}). Try again later.`);
    const deadline = Date.now() + 20_000;
    let state: 'results' | 'empty' | null = null;
    while (!state && Date.now() < deadline) {
      ctx.throwIfCancelled();
      if (await findVisible(page, S.search.noResults)) state = 'empty';
      else if ((await page.locator('main li a[href*="/in/"]').count()) > 0) state = 'results';
      else await page.waitForTimeout(400);
    }
    if (state === 'empty') break;
    if (!state) {
      if (p === 1) throw linkedinError('UNEXPECTED_PAGE', 'LinkedIn search results did not load (unexpected page). Open LinkedIn to check, then retry.');
      break;
    }
    const before = cards.length;
    for (const raw of await readCards(page)) {
      const card = toLeadCard(raw, base);
      if (card && !cards.some((c) => c.profileReference === card.profileReference)) cards.push(card);
      if (cards.length >= cfg.maxLeads) break;
    }
    if (cards.length === before) break; // nothing new on this page
  }
  return cards;
}

/**
 * One Lead Finder run: search → filter → de-duplicate into the lead list → prepare up to
 * `maxCandidates` connection drafts → WAITING_FOR_REVIEW. Never sends anything.
 */
export async function runLeadFinder(page: Page, base: string, ctx: ExecutionContext, store: LinkedInStore): Promise<TaskResult> {
  const cfg = ctx.config as unknown as LeadFinderConfig;
  const taskId = ctx.task?.id ?? null;
  const accountId = ctx.account.id;
  ctx.log.info(
    `Search criteria loaded: "${cfg.keywords || cfg.jobTitles.join(' / ')}"` +
      `${cfg.locations.length ? ` · ${cfg.locations.join(', ')}` : ''}${cfg.companies.length ? ` · ${cfg.companies.join(', ')}` : ''}` +
      ` · ${cfg.connectionDegree === 'all' ? 'all degrees' : `${cfg.connectionDegree} degree`}`,
  );

  const cards = await searchLeads(page, base, ctx, cfg);
  ctx.log.info(`Search results reviewed: ${cards.length} profile(s) read`);
  const matched = filterLeads(cards, cfg);
  ctx.log.info(`${matched.length} lead(s) identified after filters`);

  let newLeads = 0;
  const leads: Lead[] = [];
  for (const card of matched) {
    const { lead, isNew } = store.upsertLead(accountId, taskId, card, ctx.runId);
    if (isNew) newLeads++;
    leads.push(lead);
  }
  ctx.log.info(`${newLeads} new · ${matched.length - newLeads} already known (updated, not duplicated)`);

  let candidates = 0;
  if (cfg.action !== 'find_only') {
    ctx.step('Preparing connection candidates');
    for (const lead of leads) {
      if (lead.connectionDegree === '1st') {
        if (lead.status !== 'CONNECTED') store.setStatus(lead.id, 'CONNECTED', 'ALREADY_CONNECTED', '1st-degree connection', ctx.runId);
        continue;
      }
      if (candidates >= cfg.maxCandidates) break;
      if (!CANDIDATE_STATUSES.includes(lead.status) || store.activeDraft(lead.id)) continue;
      const note = cfg.action === 'prepare_with_note' && cfg.noteMode !== 'none' ? (cfg.noteMode === 'same' ? cfg.note.trim() : renderNote(cfg.note, lead)) : null;
      store.saveDraft(lead.id, taskId, note);
      store.setStatus(lead.id, 'READY_FOR_CONNECTION', 'PREPARED', note ? 'Connection draft with a note' : 'Connection draft without a note', ctx.runId);
      candidates++;
    }
    ctx.log.info(`${candidates} connection candidate(s) prepared`);
  }

  if (taskId) {
    store.insertSearch({
      taskId,
      runId: ctx.runId,
      keywords: cfg.keywords,
      location: cfg.locations.join(', ') || null,
      company: [...cfg.companies, cfg.currentCompany].filter(Boolean).join(', ') || null,
      jobTitles: cfg.jobTitles,
      industry: cfg.industry || null,
      connectionDegree: cfg.connectionDegree,
      filters: { schools: cfg.schools, profileKeywords: cfg.profileKeywords, action: cfg.action, noteMode: cfg.noteMode, maxLeads: cfg.maxLeads },
      resultsRead: cards.length,
      matched: matched.length,
      newLeads,
      candidates,
    });
  }

  const pending = taskId ? store.pendingCount(taskId) : candidates;
  const message = `${matched.length} lead(s) found (${newLeads} new) · ${candidates} connection candidate(s) prepared`;
  if (pending > 0) ctx.log.info('Task waiting for your review — nothing is sent until you confirm');
  return {
    message,
    data: { resultsRead: cards.length, matched: matched.length, newLeads, candidates, pendingReview: pending },
    review:
      pending > 0
        ? {
            pending,
            title: 'LinkedIn task completed — review needed',
            message: `${matched.length} leads found · ${pending} connection candidate(s) ready for review`,
            link: '#/platforms/linkedin/drafts',
          }
        : undefined,
  };
}
