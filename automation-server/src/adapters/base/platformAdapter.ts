import type { Router } from 'express';
import type {
  BrowserMode,
  PlatformDescriptor,
  PlatformMetric,
  RunStage,
  RunTrigger,
  Settings,
  TaskTypeDescriptor,
  ValidationCheck,
} from '@shared/types/index.js';
import type { AppConfig } from '../../config.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import type { AppDatabase, Migration } from '../../database/database.js';
import type { AccountRecord } from '../../database/repositories/accounts.js';
import type { TaskRecord } from '../../database/repositories/tasks.js';
import type { RunLogger } from '../../logging/runLogger.js';
import type { appLogger } from '../../logging/logger.js';

export interface Credentials {
  username: string;
  password: string;
}

/** What an adapter can see of the outside world during one run. Built by the TaskExecutor. */
export interface ExecutionContext {
  readonly runId: string;
  readonly trigger: RunTrigger;
  readonly attempt: number;
  readonly account: AccountRecord;
  /** Task type being executed (a platform task type, or CONNECT / TEST_LOGIN). */
  readonly taskType: string;
  /** The task instance (null for CONNECT / TEST_LOGIN). */
  readonly task: TaskRecord | null;
  /** Effective, validated configuration of the task ({} for system tasks). */
  readonly config: Record<string, unknown>;
  readonly mode: BrowserMode;
  readonly settings: Settings;
  readonly log: RunLogger;
  readonly signal: AbortSignal;
  /** True when a person asked for a visible browser (Connect): waiting for OTP/CAPTCHA is allowed. */
  readonly interactive: boolean;
  /** Value returned by `prepareTask`, if the adapter implements it. */
  readonly prepared: unknown;
  /** Input of a user-confirmed action run (null for tasks and system runs). */
  readonly payload: Record<string, unknown> | null;
  /** Move the run to the next timeline stage. */
  stage(stage: RunStage): void;
  /** Record a progress step (shown live as the run's current step) and log it. */
  step(label: string): void;
  /** Read the account's password from secure storage, only when it is about to be typed. */
  credentials(): Promise<Credentials | null>;
  /** Raise an ACTION_REQUIRED notification and flag the account (OTP / CAPTCHA detected). */
  actionRequired(kind: 'OTP_REQUIRED' | 'CAPTCHA_REQUIRED', message: string): void;
  /** Mark the account connected once the session is confirmed. */
  sessionValid(reused: boolean): void;
  throwIfCancelled(): void;
  /** Cancellable sleep. */
  sleep(ms: number): Promise<void>;
}

export type SessionState = 'authenticated' | 'unauthenticated' | 'action_required' | 'blocked' | 'unknown';

export interface TaskResult {
  /** One-line summary shown in history and notifications. */
  message: string;
  /** Structured result stored with the run. */
  data?: Record<string, unknown>;
  /**
   * The automated part is done but a person must review what it prepared (e.g. connection
   * candidates). The run ends as `waiting_for_review` and an ACTION_REQUIRED notification links there.
   */
  review?: { pending: number; title: string; message: string; link: string };
}

/**
 * An account-level operation the adapter performs ONLY because a person explicitly asked for it
 * (e.g. "send this one LinkedIn connection request"). Actions go through the same queue, logs and
 * history as tasks, but can never be scheduled: only trigger "manual" or "retry" may enqueue them.
 */
export interface AdapterAction {
  name: string;
  /** Never retried inside a run when the action has an external side effect. */
  retryable: boolean;
}

export interface ActionRequest {
  accountId: string;
  action: string;
  payload: Record<string, unknown>;
  /** Duplicate-prevention key within the action type (e.g. the lead id). */
  key: string;
}

export interface AdapterDeps {
  db: AppDatabase;
  config: AppConfig;
  /** Base URL override for this platform (mock sites in tests), or null for the real site. */
  baseUrl: string | null;
  logger: typeof appLogger;
  /** Effective configuration of one of this platform's task types (accountId null = platform default). */
  resolveConfig(taskType: string, accountId: string | null): Record<string, unknown>;
  /** Queue a user-confirmed action of this platform (bound once the executor exists). */
  runAction(req: ActionRequest): { id: string };
}

/**
 * Contract every platform implements. The core (queue, scheduler, executor, API, UI) only ever
 * talks to platforms through this interface, so adding LinkedIn later means adding an adapter.
 *
 *   platformId / platformName   identity
 *   authenticate()              make sure the account's browser session is logged in
 *   checkSession()              is the saved session still valid?
 *   getAccounts()               this platform's accounts
 *   getTasks()                  task types the UI can configure, run and schedule
 *   executeTask()               run one task type
 *   validate()                  read-only health check of the platform's selectors
 *   disconnect()                platform-specific clean-up when a session is cleared
 */
export interface PlatformAdapter {
  readonly platformId: string;
  readonly platformName: string;
  readonly descriptor: PlatformDescriptor;
  /** False for "coming soon" platforms: accounts cannot be added and nothing runs. */
  readonly available: boolean;
  /** Platform-owned tables (applied under the platform's own migration scope). */
  readonly migrations: Migration[];

  init(deps: AdapterDeps): void;
  getAccounts(): AccountRecord[];
  getTasks(): TaskTypeDescriptor[];
  getTask(taskType: string): TaskTypeDescriptor | undefined;
  /** Validate and normalise a task configuration; throws CONFIG_INVALID. */
  parseTaskConfig(taskType: string, raw: Record<string, unknown>): Record<string, unknown>;

  /** Optional username validation when an account is added. Returns an error message or null. */
  validateUsername?(username: string): string | null;
  /** Checks that must pass before a browser opens in this mode (e.g. a headless block probe). */
  preflight?(mode: BrowserMode, ctx: ExecutionContext): Promise<void>;
  /** Fail-fast work before any browser opens (e.g. find the resume file). */
  prepareTask?(ctx: ExecutionContext): Promise<unknown>;
  /** Run time limit for this task in seconds (default: Settings.taskTimeoutSec). */
  timeoutSec?(ctx: Pick<ExecutionContext, 'taskType' | 'config' | 'settings'>): number;

  checkSession(session: AutomationSession, ctx: ExecutionContext): Promise<SessionState>;
  authenticate(session: AutomationSession, ctx: ExecutionContext): Promise<{ reused: boolean }>;
  executeTask(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult>;
  validate(session: AutomationSession, ctx: ExecutionContext): Promise<ValidationCheck[]>;
  disconnect(account: AccountRecord): Promise<void>;

  /** Extra dashboard metrics (e.g. "Applications today"). */
  getMetrics?(since: Date): PlatformMetric[];
  /** User-confirmed actions this adapter supports, by type. */
  readonly actions?: Record<string, AdapterAction>;
  /** Perform a user-confirmed action (ctx.taskType = action type, ctx.payload = its input). */
  executeAction?(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult>;
  /** Items of a task instance still waiting for a person's review (drives the WAITING_FOR_REVIEW state). */
  pendingReview?(taskId: string): number;
  /** Platform-specific API routes, mounted under /platforms/<platformId>. */
  routes?(): Router;
}
