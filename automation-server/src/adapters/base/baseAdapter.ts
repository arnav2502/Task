import { z } from 'zod';
import type { PlatformDescriptor, TaskTypeDescriptor, ValidationCheck } from '@shared/types/index.js';
import type { AutomationSession } from '../../browser/browserManager.js';
import type { Migration } from '../../database/database.js';
import type { AccountRecord } from '../../database/repositories/accounts.js';
import { AutomationError } from '../../errors/automationError.js';
import type { AdapterDeps, ExecutionContext, PlatformAdapter, SessionState, TaskResult } from './platformAdapter.js';

/**
 * Shared plumbing for adapters: identity, dependency injection, account listing and Zod-based
 * task configuration validation. Concrete adapters implement the automation methods.
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly descriptor: PlatformDescriptor;
  readonly migrations: Migration[] = [];
  /** Zod schema per task type. Each schema must fill every default itself. */
  protected readonly configSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {};
  private _deps: AdapterDeps | null = null;

  get platformId() {
    return this.descriptor.id;
  }
  get platformName() {
    return this.descriptor.name;
  }
  get available() {
    return this.descriptor.status === 'active';
  }

  protected get deps(): AdapterDeps {
    if (!this._deps) throw new Error(`Adapter "${this.platformId}" used before init()`);
    return this._deps;
  }

  init(deps: AdapterDeps): void {
    this._deps = deps;
  }

  getAccounts(): AccountRecord[] {
    return this.deps.db.accounts.list(this.platformId);
  }

  getTasks(): TaskTypeDescriptor[] {
    return this.descriptor.tasks;
  }

  getTask(taskType: string): TaskTypeDescriptor | undefined {
    return this.descriptor.tasks.find((t) => t.type === taskType);
  }

  parseTaskConfig(taskType: string, raw: Record<string, unknown>): Record<string, unknown> {
    const schema = this.configSchemas[taskType];
    if (!schema) return {};
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new AutomationError('CONFIG_INVALID', parsed.error.issues.map((i) => `${i.path.join('.') || 'configuration'}: ${i.message}`).join('; '));
    }
    return parsed.data;
  }

  abstract checkSession(session: AutomationSession, ctx: ExecutionContext): Promise<SessionState>;
  abstract authenticate(session: AutomationSession, ctx: ExecutionContext): Promise<{ reused: boolean }>;
  abstract executeTask(session: AutomationSession, ctx: ExecutionContext): Promise<TaskResult>;

  async validate(_session: AutomationSession, _ctx: ExecutionContext): Promise<ValidationCheck[]> {
    void _session;
    void _ctx;
    return [];
  }

  async disconnect(_account: AccountRecord): Promise<void> {
    void _account;
  }
}
