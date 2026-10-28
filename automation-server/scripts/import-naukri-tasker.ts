/**
 * One-time migration from the earlier "Naukri Tasker" project (naukri-auto-updater) into TaskPilot.
 *
 *   npm run import:naukri-tasker -- --from "C:\path\to\naukri-auto-updater"            (dry run: shows the plan)
 *   npm run import:naukri-tasker -- --from "C:\path\to\naukri-auto-updater" --apply    (imports)
 *
 * Imports, per account: name, username and password (read from the old OS keychain entry or its
 * encrypted vault and stored in TaskPilot's own secure storage — never printed), browser mode,
 * headline baseline, the logged-in browser profile (no new login needed), per-account resume folder,
 * and the full Share Interest history (so no role is ever applied to twice). Also imports the
 * resume / marker / Share Interest settings as Naukri platform defaults, the generic settings, and
 * every schedule — schedules are imported DISABLED so the two services never run the same task twice.
 *
 * Stop the TaskPilot service before applying (it must not hold the database). Re-running skips
 * accounts that already exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Entry } from '@napi-rs/keyring';
import { DEFAULT_PORT } from '@shared/constants/index.js';
import type { BrowserMode, ScheduleFrequency, Settings } from '@shared/types/index.js';
import { NAUKRI_TASKS } from '@shared/types/naukri.js';
import { NaukriStore } from '../src/adapters/naukri/store.js';
import { loadConfig } from '../src/config.js';
import { createServices } from '../src/container.js';
import { EncryptedVaultStore } from '../src/credentials/credentialManager.js';
import { appLogger } from '../src/logging/logger.js';

type Row = Record<string, unknown>;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const from = opt('from');
const apply = flag('apply');
const copyProfiles = !flag('no-profiles');
if (!from) {
  console.error('Usage: npm run import:naukri-tasker -- --from "<naukri-auto-updater folder>" [--apply] [--no-profiles]');
  process.exit(1);
}
const oldData = path.join(from, 'data');
const oldDbFile = path.join(oldData, 'naukri-auto-updater.sqlite');
if (!fs.existsSync(oldDbFile)) {
  console.error(`Not found: ${oldDbFile}`);
  process.exit(1);
}

const TASK_MAP: Record<string, string> = {
  profile: NAUKRI_TASKS.PROFILE_UPDATE,
  resume: NAUKRI_TASKS.RESUME_UPLOAD,
  'share-interest': NAUKRI_TASKS.SHARE_INTEREST,
};

async function serviceRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function readOldPassword(ref: string, keyringService: string): Promise<string | null> {
  const [kind, ...rest] = ref.split(':');
  const id = rest.join(':');
  try {
    if (kind === 'keyring') return new Entry(keyringService, id).getPassword() ?? null;
    if (kind === 'vault') return await new EncryptedVaultStore(path.join(oldData, 'secrets')).get(ref);
  } catch {
    /* unreadable */
  }
  return null;
}

/** Copy a Chromium profile, skipping lock files of a browser that may still be open. */
function copyProfile(src: string, dest: string) {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (p) => !/(^|[\\/])(lockfile|SingletonLock|SingletonCookie|SingletonSocket)$/i.test(p),
  });
}

async function main() {
  const old = new Database(oldDbFile, { readonly: true, fileMustExist: true });
  const oldSettings: Record<string, unknown> = {};
  for (const r of old.prepare('SELECT key, value FROM settings').all() as Row[]) {
    try {
      oldSettings[String(r.key)] = JSON.parse(String(r.value));
    } catch {
      /* skip */
    }
  }
  const accounts = old.prepare('SELECT * FROM accounts ORDER BY createdAt').all() as Row[];
  const schedules = old.prepare('SELECT * FROM schedules').all() as Row[];
  const resume = old.prepare('SELECT * FROM resume_settings').all() as Row[];
  const shared = old.prepare('SELECT * FROM shared_jobs ORDER BY id').all() as Row[];

  console.log(`Naukri Tasker data at ${from}`);
  console.log(`  ${accounts.length} account(s), ${schedules.length} schedule(s), ${shared.length} Share Interest record(s)`);
  for (const a of accounts) console.log(`  • ${String(a.name)} (${String(a.username).replace(/^(.{3}).*(@.*)$/, '$1***$2')})`);
  if (!apply) {
    console.log('\nDry run — nothing was changed. Add --apply to import (stop the TaskPilot service first).');
    return;
  }
  if (await serviceRunning()) {
    console.error('\nThe TaskPilot service is running. Stop it first, then re-run with --apply.');
    process.exit(1);
  }

  appLogger.quiet = true;
  const config = loadConfig();
  const s = await createServices(config);
  const store = new NaukriStore(s.db.raw);
  const keyringService = 'naukri-auto-updater';
  const idMap = new Map<string, string>();
  /** Accounts created by this run; schedules are only imported for these (re-runs never duplicate them). */
  const newAccounts = new Set<string>();

  // ---- generic settings
  const patch: Partial<Settings> = {};
  const take = <K extends keyof Settings>(k: K, v: unknown) => {
    if (v !== undefined) patch[k] = v as Settings[K];
  };
  take('defaultMode', oldSettings.defaultMode);
  take('maxConcurrent', oldSettings.maxConcurrent);
  take('missedPolicy', oldSettings.missedPolicy);
  take('retryEnabled', oldSettings.retryEnabled);
  take('maxRetries', oldSettings.maxRetries);
  take('notifyFailures', oldSettings.notifications);
  take('notifySuccess', oldSettings.notifySuccess);
  take('screenshotOnFailure', oldSettings.screenshotOnFailure);
  take('screenshotOnSuccess', oldSettings.screenshotOnSuccess);
  take('taskTimeoutSec', oldSettings.taskTimeoutSec);
  take('verificationWaitSec', oldSettings.verificationWaitSec);
  take('requireChromeOpen', oldSettings.requireChromeOpen);
  s.db.settings.save(patch);
  console.log(`✓ Settings (${Object.keys(patch).length} values)`);

  // ---- Naukri platform defaults
  if (typeof oldSettings.marker === 'string') s.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.PROFILE_UPDATE, { marker: oldSettings.marker });
  const si = oldSettings.shareInterest as Record<string, unknown> | undefined;
  if (si) {
    s.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.SHARE_INTEREST, {
      rolesPerRun: si.maxPerRun,
      dailyLimit: si.dailyCap,
      minDelaySec: si.minDelaySec,
      maxDelaySec: si.maxDelaySec,
      includeKeywords: si.includeKeywords ?? [],
      excludeKeywords: si.excludeKeywords ?? [],
    });
  }
  const globalResume = resume.find((r) => r.accountId === null);
  if (globalResume?.folderPath) {
    s.tasks.setPlatformConfig('naukri', NAUKRI_TASKS.RESUME_UPLOAD, {
      folderPath: String(globalResume.folderPath),
      selectionMode: globalResume.selectionMode === 'specific' ? 'specific' : 'latest',
      specificFile: String(globalResume.specificFile ?? ''),
    });
  }
  console.log('✓ Naukri defaults (marker, Share Interest, resume folder)');

  // ---- accounts
  for (const a of accounts) {
    const name = String(a.name);
    const username = String(a.username);
    const existing = s.db.accounts.findByUsername('naukri', username);
    if (existing) {
      idMap.set(String(a.id), existing.id);
      console.log(`• ${name}: already in TaskPilot — skipped (history still merged below)`);
      continue;
    }
    const password = await readOldPassword(String(a.encryptedCredentialReference), keyringService);
    if (!password) console.warn(`! ${name}: the old password could not be read — add it later under Accounts → Edit`);
    const created = await s.accounts.create({
      platformId: 'naukri',
      name,
      username,
      password: password ?? '__missing__',
      enabled: a.enabled === 1,
      modeOverride: (a.modeOverride as BrowserMode | null) ?? null,
    });
    if (!password) {
      const ref = s.db.accounts.credentialRef(created.id);
      if (ref) await s.credentials.remove(ref.reference);
      s.db.raw.prepare('DELETE FROM credentials WHERE account_id = ?').run(created.id);
      s.accounts.setStatus(created.id, 'auth_required', 'Password not imported — edit the account');
    }
    idMap.set(String(a.id), created.id);
    newAccounts.add(String(a.id));
    if (a.markerBaseline) store.setMarkerBaseline(created.id, String(a.markerBaseline));
    const own = resume.find((r) => r.accountId === a.id);
    if (own?.folderPath && own.enabled === 1) {
      const task = s.db.tasks.findByType(created.id, NAUKRI_TASKS.RESUME_UPLOAD)!;
      s.tasks.update(task.id, {
        configuration: { folderPath: String(own.folderPath), selectionMode: own.selectionMode === 'specific' ? 'specific' : 'latest', specificFile: String(own.specificFile ?? '') },
      });
    }
    const oldProfile = String(a.browserProfilePath ?? '');
    if (copyProfiles && oldProfile && fs.existsSync(oldProfile)) {
      copyProfile(oldProfile, s.accounts.profileDir(created));
      if (a.status === 'connected') s.accounts.setStatus(created.id, 'connected', 'Session imported from Naukri Tasker');
    }
    console.log(`✓ ${name}${password ? ' (password moved to secure storage)' : ''}${copyProfiles && fs.existsSync(oldProfile) ? ', browser session copied' : ''}`);
  }

  // ---- Share Interest history (prevents duplicate applications)
  let historyCount = 0;
  const known = new Set(
    (s.db.raw.prepare(`SELECT account_id || ':' || job_id || ':' || shared_at AS k FROM naukri_shared_jobs`).all() as Array<{ k: string }>).map((r) => r.k),
  );
  const insert = s.db.raw.prepare(
    `INSERT INTO naukri_shared_jobs (account_id, job_id, title, company, experience, salary, location, status, message, run_id, shared_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  s.db.transaction(() => {
    for (const j of shared) {
      const accountId = idMap.get(String(j.accountId));
      if (!accountId || known.has(`${accountId}:${String(j.jobId)}:${String(j.sharedAt)}`)) continue;
      insert.run(accountId, j.jobId, j.title, j.company, j.experience, j.salary, j.location, j.status, j.message, j.sharedAt);
      historyCount++;
    }
  });
  console.log(`✓ ${historyCount} Share Interest record(s)`);

  // ---- schedules (disabled)
  let scheduleCount = 0;
  for (const sc of schedules) {
    const accountId = idMap.get(String(sc.accountId));
    const taskType = TASK_MAP[String(sc.taskType)];
    if (!accountId || !taskType || !newAccounts.has(String(sc.accountId))) continue;
    const task = s.db.tasks.findByType(accountId, taskType);
    if (!task) continue;
    try {
      s.scheduler.create({
        taskId: task.id,
        frequency: sc.frequency as ScheduleFrequency,
        time: String(sc.time),
        daysOfWeek: JSON.parse(String(sc.daysOfWeek ?? '[]')) as number[],
        onceDate: (sc.onceDate as string | null) ?? null,
        windowEnd: (sc.windowEnd as string | null) ?? null,
        randomMinute: sc.randomMinute === 1,
        mode: (sc.mode as 'default') ?? 'default',
        enabled: false,
      });
      scheduleCount++;
    } catch (err) {
      console.warn(`! Schedule ${String(sc.id)} not imported: ${(err as Error).message}`);
    }
  }
  console.log(`✓ ${scheduleCount} schedule(s) imported DISABLED`);

  s.db.close();
  old.close();
  console.log(`
Done. Next steps:
  1. Stop the old Naukri Tasker so both don't automate the same account:
       (in the old folder)  npm run autostart:uninstall   — and close its service
  2. Start TaskPilot (npm start), open the extension → Schedules, and switch the imported schedules on.`);
}

main().catch((err) => {
  console.error(`Import failed: ${(err as Error).message}`);
  process.exit(1);
});
