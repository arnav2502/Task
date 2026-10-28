import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Account, AccountStatus } from '@shared/types/index.js';
import type { AccountCreateInput, AccountUpdateInput } from '@shared/schemas/index.js';
import type { AdapterRegistry } from '../adapters/base/registry.js';
import type { Credentials } from '../adapters/base/platformAdapter.js';
import type { CredentialManager } from '../credentials/credentialManager.js';
import type { AppDatabase } from '../database/database.js';
import type { AccountRecord } from '../database/repositories/accounts.js';
import { badRequest, conflict, notFound } from '../errors/automationError.js';
import type { EventBus } from '../events/eventBus.js';
import { registerSecret } from '../logging/logger.js';
import type { NotificationService } from '../notifications/notificationService.js';

/** arnav@gmail.com → ar*****@gmail.com. The extension never sees a full username. */
export function maskUsername(username: string): string {
  const at = username.indexOf('@');
  const local = at === -1 ? username : username.slice(0, at);
  const domain = at === -1 ? '' : username.slice(at);
  const keep = local.length <= 2 ? 0 : Math.min(4, Math.ceil(local.length / 3));
  return `${local.slice(0, keep)}${'*'.repeat(Math.max(4, local.length - keep))}${domain}`;
}

export const toPublicAccount = (a: AccountRecord): Account => ({ ...a, username: maskUsername(a.username) });

/**
 * Accounts of every platform. Metadata lives in SQLite; the password only in the CredentialManager.
 * Each account gets an isolated persistent browser profile:
 *   data/accounts/<platformId>/<accountId>/browser-profile
 */
export class AccountService {
  /** Called after an account is created so tasks for it exist (wired by the container). */
  onCreated: (account: AccountRecord) => void = () => {};

  constructor(
    private readonly db: AppDatabase,
    private readonly registry: AdapterRegistry,
    private readonly secrets: CredentialManager,
    private readonly bus: EventBus,
    private readonly notifications: NotificationService,
    private readonly dataDir: string,
  ) {}

  profileDir(account: Pick<AccountRecord, 'id' | 'platformId'>): string {
    return this.db.accounts.browserProfilePath(account.id) ?? path.join(this.dataDir, 'accounts', account.platformId, account.id, 'browser-profile');
  }

  list(platformId?: string): AccountRecord[] {
    return this.db.accounts.list(platformId);
  }

  get(id: string): AccountRecord {
    const a = this.db.accounts.get(id);
    if (!a) throw notFound('Account');
    return a;
  }

  async create(input: AccountCreateInput): Promise<AccountRecord> {
    const adapter = this.registry.require(input.platformId);
    if (!adapter.available) throw conflict(`${adapter.platformName} is coming soon — accounts can't be added yet.`, 'PLATFORM_UNAVAILABLE');
    const requiresLogin = adapter.descriptor.capabilities.requiresLogin;
    if (requiresLogin && !input.password) throw badRequest(`${adapter.descriptor.account.passwordLabel} is required`);
    const usernameError = adapter.validateUsername?.(input.username);
    if (usernameError) throw badRequest(usernameError);
    if (this.db.accounts.findByUsername(adapter.platformId, input.username)) {
      throw conflict(`A ${adapter.platformName} account with this ${adapter.descriptor.account.usernameLabel.toLowerCase()} already exists`);
    }

    const id = randomUUID();
    const profileDir = path.join(this.dataDir, 'accounts', adapter.platformId, id, 'browser-profile');
    // Secret first: if the keychain write fails, nothing half-created is left in the database.
    const secret = input.password ? await this.secrets.save(adapter.platformId, id, input.password) : null;
    const account = this.db.transaction(() => {
      const a = this.db.accounts.insert({
        id,
        platformId: adapter.platformId,
        name: input.name,
        username: input.username,
        enabled: input.enabled ?? true,
        modeOverride: input.modeOverride ?? null,
      });
      if (secret) this.db.accounts.setCredentialRef(id, secret.backend, secret.reference);
      this.db.accounts.setBrowserProfile(id, adapter.platformId, profileDir);
      return a;
    });
    await fs.mkdir(profileDir, { recursive: true });
    this.onCreated(account);
    const fresh = this.get(id);
    this.notifications.event('account.created', `${adapter.platformName} account "${fresh.name}" added`, { platformId: fresh.platformId, accountId: id });
    this.bus.publish({ type: 'account:update', account: toPublicAccount(fresh) });
    return fresh;
  }

  async update(id: string, input: AccountUpdateInput): Promise<AccountRecord> {
    const current = this.get(id);
    const adapter = this.registry.require(current.platformId);
    const patch: Parameters<AppDatabase['accounts']['update']>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.username !== undefined && input.username !== current.username) {
      const usernameError = adapter.validateUsername?.(input.username);
      if (usernameError) throw badRequest(usernameError);
      const other = this.db.accounts.findByUsername(current.platformId, input.username);
      if (other && other.id !== id) throw conflict('Another account already uses this username');
      patch.username = input.username;
      patch.status = 'unknown';
      patch.statusMessage = 'Username changed — test the login';
    }
    if (input.password) {
      const secret = await this.secrets.save(current.platformId, id, input.password);
      this.db.accounts.setCredentialRef(id, secret.backend, secret.reference);
      if (current.status === 'login_failed' || current.status === 'auth_required') {
        patch.status = 'unknown';
        patch.statusMessage = 'Password updated — test the login';
      }
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.modeOverride !== undefined) patch.modeOverride = input.modeOverride;
    const account = this.db.accounts.update(id, patch)!;
    this.bus.publish({ type: 'account:update', account: toPublicAccount(account) });
    return account;
  }

  /** Deletes the account, its password, browser profile, tasks, schedules and platform data. */
  async remove(id: string): Promise<void> {
    const account = this.get(id);
    const ref = this.db.accounts.credentialRef(id);
    const profileRoot = path.dirname(this.profileDir(account));
    if (ref) await this.secrets.remove(ref.reference).catch(() => {});
    this.db.accounts.delete(id);
    await fs.rm(profileRoot, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    this.notifications.event('account.deleted', `Account "${account.name}" deleted`, { platformId: account.platformId, accountId: id });
    this.bus.publish({ type: 'account:deleted', accountId: id });
    this.bus.publish({ type: 'tasks:changed', accountId: id });
    this.bus.publish({ type: 'schedules:changed' });
  }

  /** Forget the saved browser session (cookies). The password is kept. */
  async disconnect(id: string): Promise<AccountRecord> {
    const account = this.get(id);
    const dir = this.profileDir(account);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    await fs.mkdir(dir, { recursive: true });
    this.db.accounts.touchBrowserProfile(id, 'last_cleared_at');
    await this.registry.require(account.platformId).disconnect(account);
    return this.setStatus(id, 'disconnected', 'Saved session cleared');
  }

  setStatus(id: string, status: AccountStatus, message: string | null = null): AccountRecord {
    const account = this.db.accounts.update(id, { status, statusMessage: message, lastCheckedAt: new Date().toISOString() });
    if (!account) throw notFound('Account');
    this.bus.publish({ type: 'account:update', account: toPublicAccount(account) });
    return account;
  }

  /** Read the password at the moment it is needed. It is registered for redaction in every log. */
  async credentials(id: string): Promise<Credentials | null> {
    const account = this.db.accounts.get(id);
    const ref = this.db.accounts.credentialRef(id);
    if (!account || !ref) return null;
    const password = await this.secrets.read(ref.reference).catch(() => null);
    if (!password) return null;
    registerSecret(password);
    return { username: account.username, password };
  }
}
