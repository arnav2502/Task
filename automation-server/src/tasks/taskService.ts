import { randomUUID } from 'node:crypto';
import type { ExecutionRun, Task, TaskLiveStatus, TaskState, TaskTypeDescriptor } from '@shared/types/index.js';
import type { TaskCreateInput, TaskUpdateInput } from '@shared/schemas/index.js';
import type { AdapterRegistry } from '../adapters/base/registry.js';
import type { PlatformAdapter } from '../adapters/base/platformAdapter.js';
import type { AppDatabase } from '../database/database.js';
import type { AccountRecord } from '../database/repositories/accounts.js';
import type { ScheduleRecord } from '../database/repositories/schedules.js';
import type { TaskRecord } from '../database/repositories/tasks.js';
import { AutomationError, badRequest, conflict, notFound } from '../errors/automationError.js';
import type { EventBus } from '../events/eventBus.js';

type ConfigScope = Pick<TaskRecord, 'platformId' | 'taskType' | 'accountId'> & { id?: string; name?: string | null };

/**
 * Task instances and their layered configuration.
 *
 * - Singleton task types (e.g. Naukri's) get one instance per account, created with the account.
 *   Config: task-type defaults ← platform defaults ← the account's override.
 * - Multi-instance task types (e.g. LinkedIn lead searches) get named instances created by the user.
 *   Config: task-type defaults ← platform defaults ← the instance's own configuration.
 *
 * Names, descriptions and available types always come from the adapter, so the UI never hard-codes tasks.
 */
export class TaskService {
  constructor(
    private readonly db: AppDatabase,
    private readonly registry: AdapterRegistry,
    private readonly bus: EventBus,
  ) {}

  /** Create the singleton task of every non-multi-instance task type for an account (idempotent). */
  ensureTasks(account: Pick<AccountRecord, 'id' | 'platformId'>) {
    const adapter = this.registry.get(account.platformId);
    if (!adapter) return;
    this.db.tasks.ensure(
      adapter
        .getTasks()
        .filter((t) => !t.multiInstance)
        .map((t) => ({ id: randomUUID(), platformId: account.platformId, accountId: account.id, taskType: t.type, enabled: true })),
    );
    this.bus.publish({ type: 'tasks:changed', accountId: account.id });
  }

  /** Make sure every account has every singleton task its adapter declares (new task types after an upgrade). */
  syncAll() {
    for (const account of this.db.accounts.list()) this.ensureTasks(account);
  }

  record(id: string): TaskRecord {
    const t = this.db.tasks.get(id);
    if (!t) throw notFound('Task');
    return t;
  }

  descriptorOf(task: Pick<TaskRecord, 'platformId' | 'taskType'>): { adapter: PlatformAdapter; descriptor: TaskTypeDescriptor } {
    const adapter = this.registry.require(task.platformId);
    const descriptor = adapter.getTask(task.taskType);
    if (!descriptor) throw new AutomationError('CONFIG_INVALID', `${adapter.platformName} no longer provides the task "${task.taskType}"`);
    return { adapter, descriptor };
  }

  /** Display name: the instance name for multi-instance tasks, else the task type's name. */
  nameOf(task: Pick<TaskRecord, 'platformId' | 'taskType' | 'name'>): string {
    return task.name ?? this.registry.get(task.platformId)?.getTask(task.taskType)?.name ?? task.taskType;
  }

  // ----------------------------------------------------------- multi-instance
  create(input: TaskCreateInput): Task {
    const account = this.db.accounts.get(input.accountId);
    if (!account) throw notFound('Account');
    const adapter = this.registry.require(account.platformId);
    const descriptor = adapter.getTask(input.taskType);
    if (!descriptor) throw notFound(`Task type "${input.taskType}"`);
    if (!descriptor.multiInstance) throw conflict(`"${descriptor.name}" exists once per account and is created automatically`);
    const id = randomUUID();
    const own = input.configuration ?? {};
    const platform = this.db.tasks.getConfig(account.platformId, input.taskType, null) ?? {};
    this.parse(adapter, input.taskType, { ...descriptor.defaultConfig, ...platform, ...own });
    this.db.transaction(() => {
      this.db.tasks.insertInstance({ id, platformId: account.platformId, accountId: account.id, taskType: input.taskType, name: input.name, enabled: input.enabled ?? true });
      if (Object.keys(own).length) this.db.tasks.setConfig(account.platformId, input.taskType, account.id, own, id);
    });
    this.bus.publish({ type: 'tasks:changed', accountId: account.id });
    return this.view(id);
  }

  /** Delete a multi-instance task (its schedules and configuration cascade). */
  delete(id: string, isBusy: (taskId: string) => boolean) {
    const task = this.record(id);
    const { descriptor } = this.descriptorOf(task);
    if (!descriptor.multiInstance) throw conflict(`"${descriptor.name}" belongs to the account and cannot be deleted on its own`);
    if (isBusy(id)) throw conflict('This task is queued or running — wait for it to finish or cancel it');
    this.db.tasks.delete(id);
    this.bus.publish({ type: 'tasks:changed', accountId: task.accountId });
    this.bus.publish({ type: 'schedules:changed' });
  }

  // ------------------------------------------------------------- configuration
  /** Platform-wide defaults for a task type (task-type defaults ← stored platform defaults). */
  platformConfig(platformId: string, taskType: string): Record<string, unknown> {
    const adapter = this.registry.require(platformId);
    const descriptor = adapter.getTask(taskType);
    if (!descriptor) throw notFound(`Task type "${taskType}"`);
    const stored = this.db.tasks.getConfig(platformId, taskType, null) ?? {};
    return this.parseOrDefaults(adapter, descriptor, { ...descriptor.defaultConfig, ...stored });
  }

  setPlatformConfig(platformId: string, taskType: string, config: Record<string, unknown>): Record<string, unknown> {
    const adapter = this.registry.require(platformId);
    const descriptor = adapter.getTask(taskType);
    if (!descriptor) throw notFound(`Task type "${taskType}"`);
    const parsed = this.parse(adapter, taskType, { ...descriptor.defaultConfig, ...config });
    this.db.tasks.setConfig(platformId, taskType, null, parsed);
    this.bus.publish({ type: 'tasks:changed', accountId: null });
    return parsed;
  }

  /** The stored override of one task: per instance for multi-instance tasks, per account otherwise. */
  private ownConfig(task: ConfigScope): Record<string, unknown> | null {
    return this.db.tasks.getConfig(task.platformId, task.taskType, task.accountId, task.name && task.id ? task.id : null);
  }

  /** Effective configuration of a task. Throws CONFIG_INVALID if it no longer validates. */
  effectiveConfig(task: ConfigScope): Record<string, unknown> {
    const { adapter, descriptor } = this.descriptorOf(task);
    const platform = this.db.tasks.getConfig(task.platformId, task.taskType, null) ?? {};
    return adapter.parseTaskConfig(task.taskType, { ...descriptor.defaultConfig, ...platform, ...(this.ownConfig(task) ?? {}) });
  }

  private parse(adapter: PlatformAdapter, taskType: string, raw: Record<string, unknown>) {
    try {
      return adapter.parseTaskConfig(taskType, raw);
    } catch (err) {
      if (err instanceof AutomationError) throw badRequest(err.message, 'CONFIG_INVALID');
      throw err;
    }
  }

  private parseOrDefaults(adapter: PlatformAdapter, descriptor: TaskTypeDescriptor, raw: Record<string, unknown>) {
    try {
      return adapter.parseTaskConfig(descriptor.type, raw);
    } catch {
      return descriptor.defaultConfig;
    }
  }

  // ----------------------------------------------------------------- mutations
  update(id: string, input: TaskUpdateInput): Task {
    const task = this.record(id);
    const { adapter, descriptor } = this.descriptorOf(task);
    const instanceId = task.name ? task.id : null;
    if (input.name !== undefined) {
      if (!task.name) throw badRequest(`"${descriptor.name}" cannot be renamed`);
      this.db.tasks.setName(id, input.name);
    }
    if (input.resetConfiguration) {
      this.db.tasks.deleteConfig(task.platformId, task.taskType, task.accountId, instanceId);
    } else if (input.configuration) {
      const existing = this.ownConfig(task) ?? {};
      const override = { ...existing, ...input.configuration };
      const platform = this.db.tasks.getConfig(task.platformId, task.taskType, null) ?? {};
      // Validate the merged result, store only the override.
      this.parse(adapter, task.taskType, { ...descriptor.defaultConfig, ...platform, ...override });
      this.db.tasks.setConfig(task.platformId, task.taskType, task.accountId, override, instanceId);
    }
    if (input.enabled !== undefined) this.db.tasks.setEnabled(id, input.enabled);
    this.bus.publish({ type: 'tasks:changed', accountId: task.accountId });
    return this.view(id);
  }

  // --------------------------------------------------------------------- views
  list(filter: { platformId?: string; accountId?: string } = {}): Task[] {
    const ctx = this.viewContext();
    return this.db.tasks
      .list(filter)
      .map((t) => this.toView(t, ctx))
      .filter((t): t is Task => t !== null);
  }

  view(id: string): Task {
    const t = this.toView(this.record(id), this.viewContext());
    if (!t) throw notFound('Task');
    return t;
  }

  private viewContext() {
    const accounts = new Map(this.db.accounts.list().map((a) => [a.id, a]));
    const active = new Map<string, ExecutionRun>();
    for (const r of this.db.runs.active()) if (r.taskId && (!active.has(r.taskId) || r.status === 'running')) active.set(r.taskId, r);
    const schedules = this.db.schedules.list();
    return { accounts, active, schedules };
  }

  /** Lifecycle state, derived from the active run, pending reviews, the last result and schedules. */
  static stateOf(t: Pick<TaskRecord, 'lastStatus'>, activeRun: ExecutionRun | undefined, pendingReview: number, schedules: ScheduleRecord[]): TaskState {
    if (activeRun) return 'RUNNING';
    if (pendingReview > 0) return 'WAITING_FOR_REVIEW';
    const scheduled = schedules.some((s) => s.enabled && s.nextRunAt);
    switch (t.lastStatus) {
      case null:
        return scheduled ? 'SCHEDULED' : 'DRAFT';
      case 'failed':
      case 'action_required':
        return 'FAILED';
      case 'cancelled':
        return scheduled ? 'SCHEDULED' : 'CANCELLED';
      default:
        return scheduled ? 'SCHEDULED' : 'COMPLETED';
    }
  }

  private toView(t: TaskRecord, ctx: ReturnType<TaskService['viewContext']>): Task | null {
    const adapter = this.registry.get(t.platformId);
    const descriptor = adapter?.getTask(t.taskType);
    const account = ctx.accounts.get(t.accountId);
    if (!adapter || !descriptor || !account) return null;
    let configuration: Record<string, unknown>;
    try {
      configuration = this.effectiveConfig(t);
    } catch {
      configuration = descriptor.defaultConfig;
    }
    const own = ctx.schedules.filter((s) => s.taskId === t.id);
    const live = t.enabled && account.enabled;
    const next = own
      .filter((s) => s.enabled && s.nextRunAt)
      .map((s) => s.nextRunAt!)
      .sort()[0];
    const activeRun = ctx.active.get(t.id);
    const pendingReview = adapter.pendingReview?.(t.id) ?? 0;
    const status: TaskLiveStatus = activeRun ? (activeRun.status as 'queued' | 'running') : (t.lastStatus ?? 'idle');
    return {
      id: t.id,
      platformId: t.platformId,
      accountId: t.accountId,
      accountName: account.name,
      taskType: t.taskType,
      name: t.name ?? descriptor.name,
      typeName: descriptor.name,
      multiInstance: !!descriptor.multiInstance,
      description: descriptor.description,
      effect: descriptor.effect,
      state: TaskService.stateOf(t, activeRun, pendingReview, live ? own : []),
      pendingReview,
      enabled: t.enabled,
      configuration,
      hasConfigOverride: this.ownConfig(t) !== null,
      status,
      lastRunAt: t.lastRunAt,
      lastRunId: t.lastRunId,
      lastStatus: t.lastStatus,
      lastError: t.lastError,
      nextRunAt: live ? (next ?? null) : null,
      scheduleCount: own.length,
      successCount: t.successCount,
      failureCount: t.failureCount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
