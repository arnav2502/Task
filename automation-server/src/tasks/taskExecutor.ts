import path from 'node:path';
import {
  QUEUE_PRIORITY,
  SYSTEM_TASK_LABELS,
  SYSTEM_TASK_TYPES,
} from '@shared/constants/index.js';
import type {
  BrowserMode,
  ExecutionRun,
  QueueItem,
  QueueSnapshot,
  RunStage,
  RunStatus,
  RunTrigger,
  ScheduleMode,
  Settings,
  ValidationCheck,
} from '@shared/types/index.js';
import type { ExecutionContext, PlatformAdapter, TaskResult } from '../adapters/base/platformAdapter.js';
import type { AdapterRegistry } from '../adapters/base/registry.js';
import type { AccountService } from '../accounts/accountService.js';
import type { AutomationSession, BrowserManager } from '../browser/browserManager.js';
import type { AppDatabase } from '../database/database.js';
import type { AccountRecord } from '../database/repositories/accounts.js';
import type { RunRecord } from '../database/repositories/runs.js';
import type { TaskRecord } from '../database/repositories/tasks.js';
import { AutomationError, CATEGORY_RULES, conflict, toAutomationError } from '../errors/automationError.js';
import type { EventBus } from '../events/eventBus.js';
import { appLogger, clock, localDate } from '../logging/logger.js';
import { RunLogger } from '../logging/runLogger.js';
import type { NotificationService } from '../notifications/notificationService.js';
import { JobQueue, type Job } from '../queue/jobQueue.js';
import type { TaskService } from './taskService.js';

export type SystemTaskType = (typeof SYSTEM_TASK_TYPES)[keyof typeof SYSTEM_TASK_TYPES];
const SYSTEM_TYPES = new Set<string>(Object.values(SYSTEM_TASK_TYPES));

export interface EnqueueRequest {
  /** A task instance … */
  taskId?: string;
  /** … or an account-level system task. */
  accountId?: string;
  systemTask?: SystemTaskType;
  /**
   * … or a user-confirmed adapter action (e.g. send one LinkedIn connection request). Only the
   * "manual" and "retry" triggers may run an action — the scheduler never can.
   */
  action?: { type: string; payload: Record<string, unknown>; key: string };
  trigger: RunTrigger;
  scheduleId?: string | null;
  mode?: ScheduleMode;
  retryOf?: string | null;
}

export interface ExecutorDeps {
  db: AppDatabase;
  registry: AdapterRegistry;
  accounts: AccountService;
  tasks: TaskService;
  browsers: BrowserManager;
  bus: EventBus;
  notifications: NotificationService;
  logsDir: string;
}

/** Everything one attempt needs; `session` is kept so a timeout / cancel can close the browser. */
export interface AttemptState {
  session: AutomationSession | null;
  screenshotPath: string | null;
  actionRequiredNotified: boolean;
  validation: ValidationCheck[] | null;
}

/** Strip internal file paths before a run leaves the service. */
export const toPublicRun = (r: RunRecord): ExecutionRun => {
  const { screenshotPath: _s, logPath: _l, payload: _p, ...run } = r;
  void _p;
  void _s;
  void _l;
  return run;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Runs every automation of every platform through one pipeline:
 *   STARTED → (prepare, no browser) → LOGIN_CHECK → TASK_EXECUTION → VERIFICATION → COMPLETED
 * with retries for temporary failures, a per-task timeout, cancellation, screenshots, a log per run,
 * account-status updates and notifications. Platform behaviour is delegated to the adapter.
 */
export class TaskExecutor {
  readonly queue: JobQueue;
  protected readonly db: AppDatabase;
  protected readonly registry: AdapterRegistry;
  protected readonly accounts: AccountService;
  protected readonly tasks: TaskService;
  protected readonly browsers: BrowserManager;
  protected readonly bus: EventBus;
  protected readonly notifications: NotificationService;
  protected readonly logsDir: string;
  private readonly waiters = new Map<string, Array<(run: RunRecord) => void>>();

  constructor(deps: ExecutorDeps) {
    this.db = deps.db;
    this.registry = deps.registry;
    this.accounts = deps.accounts;
    this.tasks = deps.tasks;
    this.browsers = deps.browsers;
    this.bus = deps.bus;
    this.notifications = deps.notifications;
    this.logsDir = deps.logsDir;
    this.queue = new JobQueue(
      (job) => this.execute(job),
      () => this.db.settings.get().maxConcurrent,
      () => this.bus.publish({ type: 'queue:changed', queue: this.snapshot() }),
      (job) => this.flushWaiters(job.runId),
    );
  }

  // ------------------------------------------------------------------ enqueue
  resolveMode(adapter: PlatformAdapter, account: AccountRecord, requested: ScheduleMode | undefined, settings: Settings): BrowserMode {
    const allowed = adapter.descriptor.capabilities.browserModes;
    const wanted = requested && requested !== 'default' ? requested : (account.modeOverride ?? settings.defaultMode);
    return allowed.includes(wanted) ? wanted : adapter.descriptor.capabilities.defaultMode;
  }

  /** Queue a run. Throws 409 if the same task is already queued or running. */
  enqueue(req: EnqueueRequest): RunRecord {
    const settings = this.db.settings.get();
    let task: TaskRecord | null = null;
    let account: AccountRecord;
    let taskType: string;
    let taskName: string;
    let retryable: boolean;
    let payload: Record<string, unknown> | null = null;
    if (req.taskId) {
      task = this.tasks.record(req.taskId);
      account = this.accounts.get(task.accountId);
      const { descriptor } = this.tasks.descriptorOf(task);
      taskType = task.taskType;
      taskName = this.tasks.nameOf(task);
      retryable = descriptor.retryable;
    } else if (req.accountId && req.action) {
      account = this.accounts.get(req.accountId);
      const def = this.registry.require(account.platformId).actions?.[req.action.type];
      if (!def) throw conflict(`Unknown action "${req.action.type}"`);
      if (req.trigger !== 'manual' && req.trigger !== 'retry') throw conflict('Actions can only be started by you, never by a schedule');
      taskType = req.action.type;
      taskName = def.name;
      retryable = def.retryable;
      payload = { ...req.action.payload, _key: req.action.key };
    } else if (req.accountId && req.systemTask) {
      account = this.accounts.get(req.accountId);
      taskType = req.systemTask;
      taskName = SYSTEM_TASK_LABELS[req.systemTask] ?? req.systemTask;
      retryable = req.systemTask === SYSTEM_TASK_TYPES.TEST_LOGIN;
    } else {
      throw new Error('enqueue needs a taskId or an accountId + systemTask');
    }
    const adapter = this.registry.require(account.platformId);
    if (!adapter.available) throw conflict(`${adapter.platformName} is not available yet`, 'PLATFORM_UNAVAILABLE');
    if (req.systemTask === SYSTEM_TASK_TYPES.CONNECT && !adapter.descriptor.capabilities.supportsConnect) {
      throw conflict(`${adapter.platformName} accounts do not need connecting`);
    }

    const dedupeKey = task ? task.id : req.action ? `${account.id}:${taskType}:${req.action.key}` : `${account.id}:${taskType}`;
    if (this.queue.has(dedupeKey)) throw conflict(`${taskName} is already queued or running for ${account.name}`, 'DUPLICATE_RUN');

    // Connect always needs a visible window so the user can sign in / type the OTP.
    const mode = req.systemTask === SYSTEM_TASK_TYPES.CONNECT ? 'headed' : this.resolveMode(adapter, account, req.mode, settings);
    const priority = QUEUE_PRIORITY[req.trigger];
    const run = this.db.runs.insert({
      platformId: account.platformId,
      accountId: account.id,
      accountName: account.name,
      taskId: task?.id ?? null,
      taskType,
      taskName,
      scheduleId: req.scheduleId ?? null,
      trigger: req.trigger,
      status: 'queued',
      mode,
      priority,
      maxAttempts: retryable && settings.retryEnabled ? 1 + settings.maxRetries : 1,
      retryOf: req.retryOf ?? null,
      payload,
    });
    this.publishRun(run);
    if (task) this.bus.publish({ type: 'tasks:changed', accountId: account.id });
    this.queue.enqueue({
      runId: run.id,
      platformId: account.platformId,
      accountId: account.id,
      dedupeKey,
      taskType,
      trigger: req.trigger,
      mode,
      priority,
      enqueuedAt: Date.now(),
      abort: new AbortController(),
    });
    return run;
  }

  /** Record a run that intentionally did not execute (missed schedule, duplicate). */
  recordSkipped(task: TaskRecord, trigger: RunTrigger, scheduleId: string | null, reason: string): RunRecord {
    const account = this.accounts.get(task.accountId);
    const { adapter, descriptor } = this.tasks.descriptorOf(task);
    const run = this.db.runs.insert({
      platformId: task.platformId,
      accountId: account.id,
      accountName: account.name,
      taskId: task.id,
      taskType: task.taskType,
      taskName: descriptor.name,
      scheduleId,
      trigger,
      status: 'skipped',
      mode: this.resolveMode(adapter, account, undefined, this.db.settings.get()),
      priority: QUEUE_PRIORITY[trigger],
      maxAttempts: 1,
      resultMessage: reason,
    });
    this.db.runs.appendLog(run.id, 'warn', null, reason);
    this.publishRun(run);
    return run;
  }

  retry(runId: string): RunRecord {
    const run = this.db.runs.get(runId);
    if (!run) throw conflict('Run not found');
    if (run.status === 'queued' || run.status === 'running') throw conflict('This run is still active');
    if (run.taskId) return this.enqueue({ taskId: run.taskId, trigger: 'retry', mode: run.mode, retryOf: run.id });
    if (run.payload) {
      const { _key, ...payload } = run.payload;
      return this.enqueue({ accountId: run.accountId, action: { type: run.taskType, payload, key: String(_key ?? '') }, trigger: 'retry', retryOf: run.id });
    }
    return this.enqueue({ accountId: run.accountId, systemTask: run.taskType as SystemTaskType, trigger: 'retry', retryOf: run.id });
  }

  cancel(runId: string): boolean {
    const where = this.queue.cancel(runId);
    if (where === 'pending') this.finish(runId, 'cancelled', { error: 'Cancelled before it started', errorCode: 'CANCELLED' });
    return where !== false;
  }

  /** Resolves when the run reaches a terminal state. */
  waitFor(runId: string, timeoutMs: number): Promise<RunRecord> {
    const run = this.db.runs.get(runId);
    if (run && run.status !== 'queued' && run.status !== 'running' && !this.queue.isRunning(runId)) return Promise.resolve(run);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AutomationError('TIMEOUT', 'The run did not finish in time')), timeoutMs);
      const list = this.waiters.get(runId) ?? [];
      list.push((r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.waiters.set(runId, list);
    });
  }

  snapshot(): QueueSnapshot {
    const { running, pending } = this.queue.snapshot();
    const item = (j: Job, status: 'queued' | 'running', position: number | null): QueueItem | null => {
      const r = this.db.runs.get(j.runId);
      if (!r) return null;
      return {
        runId: r.id,
        platformId: r.platformId,
        accountId: r.accountId,
        accountName: r.accountName,
        taskType: r.taskType,
        taskName: r.taskName,
        status,
        priority: r.priority,
        position,
        queuedAt: r.queuedAt,
        startedAt: r.startedAt,
      };
    };
    return {
      running: running.map((j) => item(j, 'running', null)).filter((x): x is QueueItem => !!x),
      pending: pending.map((j, i) => item(j, 'queued', i + 1)).filter((x): x is QueueItem => !!x),
      maxConcurrent: this.db.settings.get().maxConcurrent,
    };
  }

  // ---------------------------------------------------------------- execution
  private publishRun(run: RunRecord) {
    this.bus.publish({ type: 'run:update', run: toPublicRun(run) });
  }

  private update(id: string, patch: Parameters<AppDatabase['runs']['update']>[1]): RunRecord | null {
    const run = this.db.runs.update(id, patch);
    if (run) this.publishRun(run);
    return run;
  }

  private finish(id: string, status: RunStatus, patch: Parameters<AppDatabase['runs']['update']>[1] = {}): RunRecord | null {
    const run = this.update(id, { status, completedAt: new Date().toISOString(), currentStep: null, ...patch });
    if (run?.taskId) {
      this.db.tasks.recordResult(run.taskId, { runId: run.id, at: run.completedAt!, status, error: run.error });
      this.bus.publish({ type: 'tasks:changed', accountId: run.accountId });
    }
    // Waiters of a running job are released once the queue has let go of it (see flushWaiters),
    // so a caller can immediately retry or re-run the same task.
    if (run && !this.queue.isRunning(id)) this.flushWaiters(id);
    return run;
  }

  private flushWaiters(runId: string) {
    const list = this.waiters.get(runId);
    if (!list) return;
    const run = this.db.runs.get(runId);
    if (!run || run.status === 'queued' || run.status === 'running') return;
    this.waiters.delete(runId);
    list.forEach((w) => w(run));
  }

  protected runDir(job: Job): string {
    return path.join(this.logsDir, localDate(), job.platformId, job.accountId, slug(job.taskType));
  }

  private async execute(job: Job): Promise<void> {
    try {
      await this.executeRun(job);
    } catch (err) {
      // Anything unexpected outside the attempt loop (e.g. the log folder cannot be created):
      // the run must still end, never stay queued/running.
      appLogger.error(`Run ${job.runId} crashed: ${(err as Error)?.stack ?? String(err)}`);
      const run = this.db.runs.get(job.runId);
      if (run && (run.status === 'queued' || run.status === 'running')) {
        this.finish(job.runId, 'failed', { error: `Internal error: ${(err as Error)?.message ?? String(err)}`, errorCode: 'UNKNOWN' });
      }
    }
  }

  private async executeRun(job: Job): Promise<void> {
    if (job.abort.signal.aborted) return;
    const run = this.db.runs.get(job.runId);
    const account = this.db.accounts.get(job.accountId);
    if (!run || !account) {
      this.finish(job.runId, 'cancelled', { error: 'The account was deleted', errorCode: 'CANCELLED' });
      return;
    }
    const adapter = this.registry.require(account.platformId);
    const settings = this.db.settings.get();
    const task = run.taskId ? this.db.tasks.get(run.taskId) : null;
    const log = new RunLogger(
      job.runId,
      this.runDir(job),
      { append: (r, level, stage, message, ts) => this.db.runs.appendLog(r, level, stage, message, ts) },
      (line) => this.bus.publish({ type: 'run:log', line }),
    );
    log.setStage('STARTED');
    log.info('▶ STARTED');
    this.update(job.runId, { status: 'running', stage: 'STARTED', startedAt: new Date().toISOString(), logPath: log.logPath });
    log.banner(
      `RUN STARTED  ${run.id}  ${localDate()} ${clock()}\nPlatform: ${adapter.platformName}\nAccount: ${account.name}\nTask: ${run.taskName}\nMode: ${job.mode}\nTrigger: ${job.trigger}\n`,
    );
    log.info(`RUN STARTED — ${adapter.platformName} · ${account.name} · ${run.taskName} · ${job.mode} mode · ${job.trigger}`);

    const state: AttemptState = { session: null, screenshotPath: null, actionRequiredNotified: false, validation: null };
    let lastErr: AutomationError | null = null;
    let result: TaskResult = { message: '' };
    let config: Record<string, unknown> = {};

    try {
      if (task) config = this.tasks.effectiveConfig(task);
    } catch (err) {
      lastErr = toAutomationError(err);
    }

    // An invalid configuration fails the run without opening a browser.
    for (let attempt = 1; !lastErr && attempt <= run.maxAttempts; attempt++) {
      if (attempt > 1) {
        log.warn(`Retrying (attempt ${attempt}/${run.maxAttempts}) in ${settings.retryDelaySec}s`);
        this.update(job.runId, { attempt });
        await this.sleep(settings.retryDelaySec * 1000, job.abort.signal).catch(() => {});
        if (job.abort.signal.aborted) {
          lastErr = new AutomationError('CANCELLED', 'Run cancelled');
          break;
        }
      }
      try {
        // Each attempt has its own signal: aborted on cancel AND on timeout, so a timed-out attempt
        // stops at its next checkpoint instead of carrying on outside the queue's account lock.
        const attemptAbort = new AbortController();
        const forward = () => attemptAbort.abort();
        if (job.abort.signal.aborted) attemptAbort.abort();
        else job.abort.signal.addEventListener('abort', forward, { once: true });
        const ctx = this.buildContext(job, run, account, task, config, settings, log, attempt, state, attemptAbort.signal);
        try {
          result = await this.withTimeout(job, adapter, ctx, state, attemptAbort, () => this.performAttempt(job, adapter, ctx, state));
        } finally {
          job.abort.signal.removeEventListener('abort', forward);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = toAutomationError(err);
        if (job.abort.signal.aborted && lastErr.category !== 'TIMEOUT') lastErr = new AutomationError('CANCELLED', 'Run cancelled');
        log.error(`${lastErr.code}: ${lastErr.message}`);
        if (lastErr.category === 'UNKNOWN' && lastErr.cause) appLogger.error(String((lastErr.cause as Error)?.stack ?? lastErr.cause));
        if (!lastErr.retryable || attempt >= run.maxAttempts) break;
        lastErr = null;
      } finally {
        await state.session?.close();
        state.session = null;
      }
    }

    log.setStage('COMPLETED');
    log.info(`▶ ${lastErr ? 'FAILED' : 'SUCCESS'}`);
    if (!lastErr) {
      log.success(`RESULT: SUCCESS — ${result.message}`);
      log.banner(`\nRESULT: SUCCESS\n${result.message}\n`);
      const data = state.validation ? { ...result.data, checks: state.validation } : (result.data ?? null);
      const review = result.review && result.review.pending > 0 ? result.review : null;
      if (review) log.warn(`Waiting for your review: ${review.pending} item(s)`);
      this.finish(job.runId, review ? 'waiting_for_review' : 'success', {
        stage: 'COMPLETED',
        resultMessage: result.message,
        result: data,
        reviewCount: review?.pending ?? 0,
        screenshotPath: state.screenshotPath,
        error: null,
        errorCode: null,
      });
      if (review) {
        if (this.db.settings.get().notifyActionRequired) {
          this.notifications.notify({
            type: 'ACTION_REQUIRED',
            title: review.title,
            message: `${account.name} · ${run.taskName}: ${review.message}`,
            platformId: account.platformId,
            accountId: account.id,
            runId: run.id,
            link: review.link,
          });
        }
      } else {
        this.notifySuccess(adapter, account, run, result.message);
      }
    } else {
      const rule = CATEGORY_RULES[lastErr.category];
      log.error(`RESULT: FAILED — ${lastErr.message}`);
      log.banner(`\nRESULT: FAILED - ${lastErr.message}\n`);
      this.finish(job.runId, rule.runStatus, {
        stage: 'COMPLETED',
        error: lastErr.message,
        errorCode: lastErr.code,
        screenshotPath: state.screenshotPath,
      });
      if (rule.accountStatus) this.accounts.setStatus(account.id, rule.accountStatus, lastErr.message);
      this.notifyFailure(adapter, account, run, lastErr, state);
    }
  }

  private buildContext(
    job: Job,
    run: RunRecord,
    account: AccountRecord,
    task: TaskRecord | null,
    config: Record<string, unknown>,
    settings: Settings,
    log: RunLogger,
    attempt: number,
    state: AttemptState,
    signal: AbortSignal = job.abort.signal,
  ): ExecutionContext {
    const adapter = this.registry.require(account.platformId);
    const ctx: ExecutionContext = {
      runId: run.id,
      trigger: run.trigger,
      attempt,
      account,
      taskType: run.taskType,
      task,
      config,
      mode: job.mode,
      settings,
      log,
      signal,
      interactive: run.taskType === SYSTEM_TASK_TYPES.CONNECT,
      prepared: undefined,
      payload: run.payload ? Object.fromEntries(Object.entries(run.payload).filter(([k]) => k !== '_key')) : null,
      stage: (stage: RunStage) => {
        log.setStage(stage);
        log.info(`▶ ${stage.replace('_', ' ')}`);
        this.update(run.id, { stage });
      },
      step: (label) => {
        log.info(label);
        this.update(run.id, { currentStep: label });
      },
      credentials: () => this.accounts.credentials(account.id),
      actionRequired: (kind, message) => {
        this.accounts.setStatus(account.id, 'action_required', message);
        this.update(run.id, { currentStep: kind === 'OTP_REQUIRED' ? 'Waiting for OTP verification' : 'Waiting for CAPTCHA' });
        if (this.db.settings.get().notifyActionRequired && !state.actionRequiredNotified) {
          state.actionRequiredNotified = true;
          this.notifications.notify({
            type: 'ACTION_REQUIRED',
            title: `${adapter.platformName}: ${kind === 'OTP_REQUIRED' ? 'OTP verification required' : 'CAPTCHA verification required'}`,
            message: `${account.name}: ${message}`,
            platformId: account.platformId,
            accountId: account.id,
            runId: run.id,
          });
        }
      },
      sessionValid: (reused) => {
        this.accounts.setStatus(account.id, 'connected', reused ? 'Saved session valid' : 'Logged in');
      },
      throwIfCancelled: () => {
        if (signal.aborted) throw new AutomationError('CANCELLED', 'Run cancelled');
      },
      sleep: (ms) => this.sleep(ms, signal),
    };
    return ctx;
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new AutomationError('CANCELLED', 'Run cancelled'));
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new AutomationError('CANCELLED', 'Run cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  timeoutFor(adapter: PlatformAdapter, ctx: Pick<ExecutionContext, 'taskType' | 'config' | 'settings'>): number {
    if (ctx.taskType === SYSTEM_TASK_TYPES.CONNECT) return ctx.settings.verificationWaitSec + 120;
    if (SYSTEM_TYPES.has(ctx.taskType)) return ctx.settings.taskTimeoutSec;
    return adapter.timeoutSec?.(ctx) ?? ctx.settings.taskTimeoutSec;
  }

  private async withTimeout<T>(
    job: Job,
    adapter: PlatformAdapter,
    ctx: ExecutionContext,
    state: AttemptState,
    attemptAbort: AbortController,
    fn: () => Promise<T>,
  ): Promise<T> {
    const seconds = this.timeoutFor(adapter, ctx);
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        attemptAbort.abort();
        void state.session?.close();
        reject(new AutomationError('TIMEOUT', `Task exceeded the ${seconds}s timeout`));
      }, seconds * 1000);
    });
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => {
        void state.session?.close();
        reject(new AutomationError('CANCELLED', 'Run cancelled'));
      };
      if (job.abort.signal.aborted) onAbort();
      else job.abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    const work = fn();
    work.catch(() => {}); // settled later by the race; avoid an unhandled rejection after timeout
    try {
      return await Promise.race([work, timeout, abort]);
    } finally {
      clearTimeout(timer);
      if (onAbort) job.abort.signal.removeEventListener('abort', onAbort);
    }
  }

  /** One attempt: prepare → browser → login check → task → screenshot. Overridable in tests. */
  protected async performAttempt(job: Job, adapter: PlatformAdapter, ctx: ExecutionContext, state: AttemptState): Promise<TaskResult> {
    const settings = ctx.settings;
    const isSystem = SYSTEM_TYPES.has(ctx.taskType) || ctx.payload !== null;
    if (!isSystem && adapter.prepareTask) (ctx as { prepared: unknown }).prepared = await adapter.prepareTask(ctx);
    ctx.throwIfCancelled();
    await adapter.preflight?.(ctx.mode, ctx);
    ctx.throwIfCancelled(); // never open a browser for an attempt that already timed out / was cancelled

    const account = ctx.account;
    state.session = this.browsers.createSession(account.id, this.accounts.profileDir(account), job.mode);
    this.db.accounts.touchBrowserProfile(account.id, 'last_used_at');
    try {
      ctx.stage('LOGIN_CHECK');
      ctx.step(`Opening browser (${job.mode}) and checking the session`);
      const { reused } = await adapter.authenticate(state.session, ctx);
      let result: TaskResult;
      if (ctx.taskType === SYSTEM_TASK_TYPES.CONNECT) {
        result = { message: reused ? 'Already connected — session valid' : 'Account connected; session saved' };
      } else if (ctx.taskType === SYSTEM_TASK_TYPES.TEST_LOGIN) {
        result = { message: reused ? 'Login OK — saved session is valid' : 'Login OK — signed in and saved the session' };
      } else if (ctx.taskType === SYSTEM_TASK_TYPES.VALIDATE) {
        ctx.stage('VERIFICATION');
        state.validation = await adapter.validate(state.session, ctx);
        const missing = state.validation.filter((c) => !c.found).length;
        result = { message: missing ? `${missing} of ${state.validation.length} selectors not found` : `All ${state.validation.length} selectors found` };
      } else if (ctx.payload !== null) {
        if (!adapter.executeAction) throw new AutomationError('CONFIG_INVALID', `${adapter.platformName} has no action "${ctx.taskType}"`);
        ctx.stage('TASK_EXECUTION');
        result = await adapter.executeAction(state.session, ctx);
      } else {
        ctx.stage('TASK_EXECUTION');
        result = await adapter.executeTask(state.session, ctx);
      }
      if (settings.screenshotOnSuccess) state.screenshotPath = await this.screenshot(state.session, job, 'success', ctx);
      return result;
    } catch (err) {
      if (settings.screenshotOnFailure && state.session?.isOpen) state.screenshotPath = await this.screenshot(state.session, job, 'failure', ctx);
      throw err;
    }
  }

  private async screenshot(session: AutomationSession, job: Job, kind: 'success' | 'failure', ctx: ExecutionContext): Promise<string | null> {
    if (!session.isOpen) return null;
    const file = path.join(this.runDir(job), `${job.runId}-${clock().replace(/:/g, '')}-${kind}.png`);
    if (!(await session.screenshot(file))) return null;
    ctx.log.info(`Screenshot saved (${kind})`);
    return file;
  }

  // ------------------------------------------------------------ notifications
  private notifySuccess(adapter: PlatformAdapter, account: AccountRecord, run: RunRecord, message: string) {
    if (!this.db.settings.get().notifySuccess) return;
    const descriptor = run.taskId ? adapter.getTask(run.taskType) : undefined;
    this.notifications.notify({
      type: 'SUCCESS',
      title: descriptor?.notify?.success ?? `${adapter.platformName}: ${run.taskName} completed`,
      message: `${account.name}: ${message}`,
      platformId: account.platformId,
      accountId: account.id,
      runId: run.id,
    });
  }

  private notifyFailure(adapter: PlatformAdapter, account: AccountRecord, run: RunRecord, err: AutomationError, state: AttemptState) {
    const settings = this.db.settings.get();
    const type = CATEGORY_RULES[err.category].notification;
    if (!type) return;
    if (type === 'ACTION_REQUIRED') {
      if (!settings.notifyActionRequired || state.actionRequiredNotified) return;
      this.notifications.notify({
        type,
        title: `${adapter.platformName}: ${err.category === 'CAPTCHA_REQUIRED' ? 'CAPTCHA' : 'OTP'} verification required`,
        message: `${account.name}: ${err.message}`,
        platformId: account.platformId,
        accountId: account.id,
        runId: run.id,
      });
      return;
    }
    if (!settings.notifyFailures) return;
    const descriptor = run.taskId ? adapter.getTask(run.taskType) : undefined;
    this.notifications.notify({
      type,
      title: descriptor?.notify?.failure ?? `${adapter.platformName}: ${run.taskName} failed`,
      message: `${account.name}: ${err.message}`,
      platformId: account.platformId,
      accountId: account.id,
      runId: run.id,
    });
  }
}
