import { chromium } from 'playwright';
import type { BrowserMode, PlatformMetric, ValidationCheck } from '@shared/types/index.js';
import { NAUKRI_TASKS, type ResumeFileInfo, type ResumeUploadConfig, type ShareInterestConfig } from '@shared/types/naukri.js';
import { describeCandidate, findAttached, findVisible, type SelectorDef } from '../../browser/locate.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import { AutomationError } from '../../errors/automationError.js';
import { BasePlatformAdapter } from '../base/baseAdapter.js';
import type { ExecutionContext, SessionState, TaskResult } from '../base/platformAdapter.js';
import { NAUKRI_CONFIG_SCHEMAS, NAUKRI_DESCRIPTOR } from './descriptor.js';
import { naukriError } from './errors.js';
import { scanResumeFolder } from './resumeFiles.js';
import { naukriRoutes } from './routes.js';
import { HEADLINE_DRAWER_CHECKS, PROFILE_PAGE_CHECKS, naukriUrls, signals } from './selectors.js';
import { ensureSession, openAndClassify } from './session.js';
import { NAUKRI_MIGRATIONS, NaukriStore } from './store.js';
import { closeHeadlineEditor, peekHeadlineEditor, updateProfile } from './tasks/profileUpdate.js';
import { uploadResume } from './tasks/resumeUpload.js';
import { shareInterest } from './tasks/shareInterest.js';

const DEFAULT_BASE_URL = 'https://www.naukri.com';
const PREFLIGHT_TTL_MS = 15 * 60_000;
const ATTACHED_ONLY = new Set(['resume.fileInput', 'resume.messageBox']);

/**
 * Naukri platform adapter: login/session, Profile Update, Resume Upload and Share Interest.
 * Flows, selectors and safeguards were verified against the live site (docs/NAUKRI.md).
 */
export class NaukriAdapter extends BasePlatformAdapter {
  readonly descriptor = NAUKRI_DESCRIPTOR;
  override readonly migrations = NAUKRI_MIGRATIONS;
  protected override readonly configSchemas = NAUKRI_CONFIG_SCHEMAS as unknown as Record<string, import('zod').ZodType<Record<string, unknown>>>;
  private storeInstance: NaukriStore | null = null;
  private preflightCache: { at: number; ok: boolean } | null = null;

  get baseUrl(): string {
    return this.deps.baseUrl ?? DEFAULT_BASE_URL;
  }

  get store(): NaukriStore {
    this.storeInstance ??= new NaukriStore(this.deps.db.raw);
    return this.storeInstance;
  }

  validateUsername(username: string): string | null {
    return /\s/.test(username) ? 'The Naukri email / username cannot contain spaces' : null;
  }

  timeoutSec(ctx: Pick<ExecutionContext, 'taskType' | 'config' | 'settings'>): number {
    if (ctx.taskType !== NAUKRI_TASKS.SHARE_INTEREST) return ctx.settings.taskTimeoutSec;
    const cfg = ctx.config as unknown as ShareInterestConfig;
    // Per role: a full pause plus up to ~2 min of page work (listing reload, reading pause, confirmation).
    return ctx.settings.taskTimeoutSec + cfg.rolesPerRun * (cfg.maxDelaySec + 120);
  }

  /**
   * Headless preflight. Naukri's CDN answers headless Chrome with "403 Access Denied", and a blocked
   * request made with an account's cookies was seen to sign that account out. So before a headless
   * run touches a profile, probe once from a throwaway, cookie-less browser (cached 15 min).
   */
  async preflight(mode: BrowserMode, ctx: ExecutionContext): Promise<void> {
    if (mode !== 'headless') return;
    if (!this.preflightCache || Date.now() - this.preflightCache.at > PREFLIGHT_TTL_MS) {
      ctx.step('Checking whether Naukri allows headless browsers');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const res = await page.goto(naukriUrls(this.baseUrl).login, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        this.preflightCache = { at: Date.now(), ok: !(res?.status() === 403 || signals.blockedTitle.test(await page.title())) };
      } finally {
        await browser.close();
      }
    }
    if (!this.preflightCache.ok) {
      throw naukriError(
        'HEADLESS_BLOCKED',
        'Naukri blocked the headless browser (HTTP 403 "Access Denied"). Your saved session was not touched. Use Background or Headed mode.',
      );
    }
  }

  /** Resume Upload fails fast — before any browser opens — when there is no valid PDF. */
  async prepareTask(ctx: ExecutionContext): Promise<ResumeFileInfo | null> {
    if (ctx.taskType !== NAUKRI_TASKS.RESUME_UPLOAD) return null;
    const cfg = ctx.config as unknown as ResumeUploadConfig;
    ctx.step('Scanning the resume folder');
    if (!cfg.folderPath) throw naukriError('RESUME_NOT_FOUND', 'No resume folder configured. Choose one under Naukri → Resume.');
    const scan = await scanResumeFolder(cfg);
    if (!scan.selected) throw naukriError('RESUME_NOT_FOUND', `Resume not found: ${scan.error ?? 'no PDF in the folder'} (${cfg.folderPath})`);
    if (scan.selected.tooLarge) throw naukriError('RESUME_TOO_LARGE', scan.error ?? `${scan.selected.name} is larger than 2 MB`);
    ctx.log.info(`Selected resume: ${scan.selected.name} (modified ${new Date(scan.selected.modifiedAt).toLocaleString('en-IN')})`);
    return scan.selected;
  }

  async checkSession(session: AutomationSession, ctx: ExecutionContext): Promise<SessionState> {
    const state = await openAndClassify(await session.page(), this.baseUrl, ctx);
    if (state === 'logged_in') return 'authenticated';
    if (state === 'otp' || state === 'captcha') return 'action_required';
    if (state === 'blocked') return 'blocked';
    if (state === 'login_page' || state === 'login_error') return 'unauthenticated';
    return 'unknown';
  }

  authenticate(session: AutomationSession, ctx: ExecutionContext): Promise<{ reused: boolean }> {
    return ensureSession(session, this.baseUrl, ctx);
  }

  async executeTask(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult> {
    const page = await session.page();
    switch (ctx.taskType) {
      case NAUKRI_TASKS.PROFILE_UPDATE:
        return updateProfile(page, this.baseUrl, ctx, this.store);
      case NAUKRI_TASKS.RESUME_UPLOAD: {
        const file = ctx.prepared as ResumeFileInfo | null;
        if (!file) throw naukriError('RESUME_NOT_FOUND', 'No resume selected');
        return uploadResume(page, this.baseUrl, ctx, file);
      }
      case NAUKRI_TASKS.SHARE_INTEREST:
        return shareInterest(page, this.baseUrl, ctx, this.store);
      default:
        throw new AutomationError('CONFIG_INVALID', `Naukri has no task "${ctx.taskType}"`);
    }
  }

  /** Read-only selector health check: opens the headline editor and closes it without saving. */
  override async validate(session: AutomationSession, ctx: ExecutionContext): Promise<ValidationCheck[]> {
    const page = await session.page();
    if ((await this.checkSession(session, ctx)) !== 'authenticated') {
      throw new AutomationError('AUTH_REQUIRED', 'Sign in first (Connect or Test login), then validate the selectors.');
    }
    await page.waitForTimeout(2000);
    const check = async (key: string, def: SelectorDef): Promise<ValidationCheck> => {
      const hit = ATTACHED_ONLY.has(key) ? await findAttached(page, def) : await findVisible(page, def);
      return { key, description: def.description, found: !!hit, matched: hit ? describeCandidate(hit.candidate) : null };
    };
    const results: ValidationCheck[] = [];
    for (const [key, def] of PROFILE_PAGE_CHECKS) results.push(await check(key, def));
    try {
      await peekHeadlineEditor(page);
      for (const [key, def] of HEADLINE_DRAWER_CHECKS) results.push(await check(key, def));
    } catch {
      for (const [key, def] of HEADLINE_DRAWER_CHECKS) results.push({ key, description: def.description, found: false, matched: null });
    } finally {
      await closeHeadlineEditor(page).catch(() => {});
    }
    for (const r of results) ctx.log[r.found ? 'success' : 'warn'](`${r.found ? 'Found' : 'MISSING'}: ${r.description}${r.matched ? ` (${r.matched})` : ''}`);
    return results;
  }

  getMetrics(since: Date): PlatformMetric[] {
    return [{ key: 'applications', label: 'Applications today', value: this.store.countSharedSince(null, since.toISOString()), hint: 'Share Interest' }];
  }

  routes() {
    return naukriRoutes({ db: this.deps.db, store: this.store, resolveConfig: this.deps.resolveConfig });
  }
}
