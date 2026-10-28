import path from 'node:path';
import { AccountService } from './accounts/accountService.js';
import { createDefaultRegistry } from './adapters/index.js';
import type { AdapterRegistry } from './adapters/base/registry.js';
import { BrowserManager } from './browser/browserManager.js';
import type { AppConfig } from './config.js';
import { CredentialManager } from './credentials/credentialManager.js';
import { AppDatabase } from './database/database.js';
import { EventBus } from './events/eventBus.js';
import { appLogger } from './logging/logger.js';
import { NotificationService } from './notifications/notificationService.js';
import { Scheduler } from './scheduler/scheduler.js';
import { DashboardService } from './server/dashboardService.js';
import { TaskExecutor, type ExecutorDeps } from './tasks/taskExecutor.js';
import { TaskService } from './tasks/taskService.js';

export interface Services {
  config: AppConfig;
  db: AppDatabase;
  registry: AdapterRegistry;
  credentials: CredentialManager;
  bus: EventBus;
  notifications: NotificationService;
  accounts: AccountService;
  tasks: TaskService;
  browsers: BrowserManager;
  executor: TaskExecutor;
  scheduler: Scheduler;
  dashboard: DashboardService;
}

export interface ServiceOptions {
  registry?: AdapterRegistry;
  /** Swap the executor (tests replace the browser work with a fake). */
  executor?: (deps: ExecutorDeps) => TaskExecutor;
}

/** Composition root: builds every service once, in dependency order. */
export async function createServices(config: AppConfig, opts: ServiceOptions = {}): Promise<Services> {
  const db = new AppDatabase(path.join(config.dataDir, 'taskpilot.sqlite'));
  const orphaned = db.runs.cancelOrphaned();
  if (orphaned) appLogger.warn(`Marked ${orphaned} unfinished run(s) from a previous session as cancelled`);

  const registry = opts.registry ?? createDefaultRegistry();
  const bus = new EventBus();
  const tasks = new TaskService(db, registry, bus);
  // Bound below, once the executor exists (adapters only call it from API routes, never during start-up).
  let executorRef: TaskExecutor | null = null;
  for (const adapter of registry.list()) {
    const platformId = adapter.platformId;
    adapter.init({
      db,
      config,
      baseUrl: config.platformBaseUrls[platformId] ?? null,
      logger: appLogger,
      resolveConfig: (taskType, accountId) =>
        accountId ? tasks.effectiveConfig({ platformId, taskType, accountId }) : tasks.platformConfig(platformId, taskType),
      runAction: (req) => {
        if (!executorRef) throw new Error('The executor is not ready yet');
        return executorRef.enqueue({ accountId: req.accountId, action: { type: req.action, payload: req.payload, key: req.key }, trigger: 'manual' });
      },
    });
    const applied = db.migrate(adapter.platformId, adapter.migrations);
    if (applied) appLogger.info(`Applied ${applied} ${adapter.platformName} migration(s)`);
  }
  db.platforms.sync(registry.list().map((a) => ({ id: a.platformId, name: a.platformName, status: a.descriptor.status })));

  const credentials = await CredentialManager.create({
    dataDir: config.dataDir,
    keyringService: config.keyringService,
    credentialKey: config.credentialKey,
    forceVault: config.forceVault,
  });
  const notifications = new NotificationService(db, bus);
  const accounts = new AccountService(db, registry, credentials, bus, notifications, config.dataDir);
  accounts.onCreated = (a) => tasks.ensureTasks(a);
  tasks.syncAll();

  const browsers = new BrowserManager();
  const deps: ExecutorDeps = { db, registry, accounts, tasks, browsers, bus, notifications, logsDir: config.logsDir };
  const executor = opts.executor ? opts.executor(deps) : new TaskExecutor(deps);
  executorRef = executor;
  const scheduler = new Scheduler(db, tasks, executor, bus, notifications, config.schedulerTickMs);
  const dashboard = new DashboardService(db, registry, tasks, executor);
  return { config, db, registry, credentials, bus, notifications, accounts, tasks, browsers, executor, scheduler, dashboard };
}
