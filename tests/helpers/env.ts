import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLATFORM_IDS } from '@shared/constants/index';
import type { ExecutionRun, Settings } from '@shared/types/index';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { loadConfig, type AppConfig } from '../../automation-server/src/config';
import { createServices, type ServiceOptions, type Services } from '../../automation-server/src/container';
import type { AccountRecord } from '../../automation-server/src/database/repositories/accounts';
import type { TaskRecord } from '../../automation-server/src/database/repositories/tasks';
import { appLogger } from '../../automation-server/src/logging/logger';
import { MockLinkedIn, type MockLinkedInOptions } from '../mock/mockLinkedIn';
import { MockNaukri, type MockOptions } from '../mock/mockNaukri';

appLogger.quiet = true;

export const tmpRoot = path.join(os.tmpdir(), 'taskpilot-tests');

export function makeTempDir(prefix: string) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  return fs.mkdtempSync(path.join(tmpRoot, `${prefix}-`));
}

export interface TestEnv {
  dir: string;
  config: AppConfig;
  services: Services;
  mock: MockNaukri | null;
  linkedin: MockLinkedIn | null;
  close(): Promise<void>;
}

/**
 * A fresh, isolated service stack: temp database and logs, the encrypted-file vault (never the
 * real OS keychain), and optionally the mock Naukri site as Naukri's base URL.
 */
export async function createEnv(
  opts: {
    mock?: MockOptions | false;
    /** Start the mock LinkedIn site (off by default). */
    linkedin?: MockLinkedInOptions | false;
    settings?: Partial<Settings>;
    services?: ServiceOptions;
    config?: Partial<AppConfig>;
  } = {},
): Promise<TestEnv> {
  const dir = makeTempDir('env');
  let mock: MockNaukri | null = null;
  let baseUrl = 'http://127.0.0.1:9';
  if (opts.mock !== false) {
    mock = new MockNaukri(opts.mock ?? {});
    baseUrl = await mock.start();
  }
  let linkedin: MockLinkedIn | null = null;
  if (opts.linkedin) {
    linkedin = new MockLinkedIn(opts.linkedin);
    await linkedin.start();
  }
  const config = loadConfig({
    dataDir: path.join(dir, 'data'),
    logsDir: path.join(dir, 'logs'),
    platformBaseUrls: { [PLATFORM_IDS.NAUKRI]: baseUrl, [PLATFORM_IDS.LINKEDIN]: linkedin?.baseUrl ?? 'http://127.0.0.1:9' },
    forceVault: true,
    credentialKey: undefined,
    port: 0,
    schedulerTickMs: 60_000,
    allowedExtensionId: null,
    ...opts.config,
  });
  const services = await createServices(config, opts.services);
  services.db.settings.save({
    defaultMode: 'headless',
    retryDelaySec: 0,
    verificationWaitSec: 30,
    taskTimeoutSec: 90,
    notifySuccess: true,
    setupComplete: true,
    ...opts.settings,
  });
  return {
    dir,
    config,
    services,
    mock,
    linkedin,
    async close() {
      services.scheduler.stop();
      await Promise.race([services.executor.queue.idle(), new Promise((r) => setTimeout(r, 15_000))]);
      await services.browsers.closeAll();
      services.db.close();
      await mock?.stop();
      await linkedin?.stop();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export async function addNaukriAccount(env: TestEnv, name: string, email: string, password = 'Secret#123'): Promise<AccountRecord> {
  env.mock?.addUser(email, password);
  return env.services.accounts.create({ platformId: PLATFORM_IDS.NAUKRI, name, username: email, password });
}

export function taskOf(env: TestEnv, accountId: string, taskType: string = NAUKRI_TASKS.PROFILE_UPDATE): TaskRecord {
  const t = env.services.db.tasks.findByType(accountId, taskType);
  if (!t) throw new Error(`No ${taskType} task for ${accountId}`);
  return t;
}

/** Wait until a run reaches a terminal state. */
export async function waitForRun(env: TestEnv, runId: string, timeoutMs = 120_000): Promise<ExecutionRun> {
  const run = await env.services.executor.waitFor(runId, timeoutMs);
  return run;
}

export function logsOf(env: TestEnv, runId: string): string {
  return env.services.db.runs
    .logs(runId)
    .map((l) => `${l.level}: ${l.message}`)
    .join('\n');
}

/** Create a PDF with an explicit modification time. */
export function writePdf(dir: string, name: string, mtime: Date, sizeBytes = 2048) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const header = Buffer.from('%PDF-1.4\n%mock resume\n');
  fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(Math.max(0, sizeBytes - header.length), 0x20)]));
  fs.utimesSync(file, mtime, mtime);
  return file;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function addLinkedInAccount(env: TestEnv, name = 'My LinkedIn', email = 'me@example.com'): Promise<AccountRecord> {
  return env.services.accounts.create({ platformId: PLATFORM_IDS.LINKEDIN, name, username: email });
}

/** Create a named Lead Finder task with the given configuration. */
export function addLeadTask(env: TestEnv, accountId: string, name: string, configuration: Record<string, unknown>) {
  return env.services.tasks.create({ accountId, taskType: 'LEAD_FINDER', name, configuration });
}
