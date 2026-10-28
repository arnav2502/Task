import type { PlatformMetric } from '@shared/types/index.js';
import { LINKEDIN_ACTIONS, LINKEDIN_TASKS } from '@shared/types/linkedin.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import { AutomationError } from '../../errors/automationError.js';
import { BasePlatformAdapter } from '../base/baseAdapter.js';
import type { AdapterAction, ExecutionContext, SessionState, TaskResult } from '../base/platformAdapter.js';
import { sendConnection } from './connectionAssistant.js';
import { LEAD_FINDER_SCHEMA, LINKEDIN_DESCRIPTOR } from './descriptor.js';
import { runLeadFinder } from './leadFinder.js';
import { linkedinRoutes } from './routes.js';
import { checkLinkedInSession, ensureLinkedInSession } from './session.js';
import { LINKEDIN_MIGRATIONS, LinkedInStore } from './store.js';

const DEFAULT_BASE_URL = 'https://www.linkedin.com';

/**
 * LinkedIn adapter — a user-controlled assistant:
 *   LEAD_FINDER (task, schedulable)  search → filter → de-duplicated leads → connection drafts → review
 *   SEND_CONNECTION (action)         sends ONE request a person confirmed; never scheduled, never bulk
 */
export class LinkedInAdapter extends BasePlatformAdapter {
  readonly descriptor = LINKEDIN_DESCRIPTOR;
  override readonly migrations = LINKEDIN_MIGRATIONS;
  protected override readonly configSchemas = { [LINKEDIN_TASKS.LEAD_FINDER]: LEAD_FINDER_SCHEMA } as unknown as Record<
    string,
    import('zod').ZodType<Record<string, unknown>>
  >;
  readonly actions: Record<string, AdapterAction> = {
    // A send has an external side effect: never retried automatically.
    [LINKEDIN_ACTIONS.SEND_CONNECTION]: { name: 'Send connection request', retryable: false },
  };
  private storeInstance: LinkedInStore | null = null;

  get baseUrl(): string {
    return this.deps.baseUrl ?? DEFAULT_BASE_URL;
  }

  get store(): LinkedInStore {
    this.storeInstance ??= new LinkedInStore(this.deps.db.raw);
    return this.storeInstance;
  }

  validateUsername(username: string): string | null {
    return /\s/.test(username) ? 'The LinkedIn email cannot contain spaces' : null;
  }

  timeoutSec(ctx: Pick<ExecutionContext, 'taskType' | 'config' | 'settings'>): number {
    if (ctx.taskType !== LINKEDIN_TASKS.LEAD_FINDER) return ctx.settings.taskTimeoutSec;
    // A few results pages with reading pauses.
    return ctx.settings.taskTimeoutSec + 60 * Math.ceil(Number(ctx.config.maxLeads ?? 20) / 10);
  }

  async checkSession(session: AutomationSession, ctx: ExecutionContext): Promise<SessionState> {
    return checkLinkedInSession(await session.page(), this.baseUrl, ctx);
  }

  authenticate(session: AutomationSession, ctx: ExecutionContext): Promise<{ reused: boolean }> {
    return ensureLinkedInSession(session, this.baseUrl, ctx);
  }

  // ------------------------------------------------- generic operations (spec)
  /** Run a Lead Finder task: searchLeads → filterLeads → prepareConnection / createConnectionDraft. */
  async executeTask(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult> {
    if (ctx.taskType !== LINKEDIN_TASKS.LEAD_FINDER) throw new AutomationError('CONFIG_INVALID', `LinkedIn has no task "${ctx.taskType}"`);
    return runLeadFinder(await session.page(), this.baseUrl, ctx, this.store);
  }

  /** User-confirmed actions only. */
  async executeAction(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult> {
    if (ctx.taskType !== LINKEDIN_ACTIONS.SEND_CONNECTION) throw new AutomationError('CONFIG_INVALID', `LinkedIn has no action "${ctx.taskType}"`);
    return sendConnection(await session.page(), ctx, this.store);
  }

  pendingReview(taskId: string): number {
    return this.store.pendingCount(taskId);
  }

  getMetrics(since: Date): PlatformMetric[] {
    const s = this.store.stats(null, since.toISOString());
    return [
      { key: 'leadsFound', label: 'Leads found', value: s.leadsFound, hint: `${s.leadsToday} today` },
      { key: 'reviewed', label: 'Reviewed', value: s.reviewed },
      { key: 'selected', label: 'Selected', value: s.selected },
      { key: 'pendingReview', label: 'Pending review', value: s.pendingReview },
      { key: 'connectionsSent', label: 'Connections sent', value: s.connectionsSent },
      { key: 'connected', label: 'Connected', value: s.connected },
      { key: 'skipped', label: 'Skipped', value: s.skipped },
    ];
  }

  routes() {
    return linkedinRoutes({ db: this.deps.db, store: this.store, runAction: this.deps.runAction });
  }
}
