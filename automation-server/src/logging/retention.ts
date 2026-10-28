import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../database/database.js';
import { appLogger } from './logger.js';

export interface CleanupResult {
  runsDeleted: number;
  filesDeleted: number;
  eventsDeleted: number;
  notificationsDeleted: number;
}

/** Delete files older than the cutoff (except protected ones), then folders left empty. */
function sweep(dir: string, cutoffMs: number, keep: Set<string>, res: CleanupResult, isRoot: boolean): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let remaining = entries.length;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (sweep(full, cutoffMs, keep, res, false)) remaining--;
      continue;
    }
    if (isRoot && (e.name.startsWith('service') || e.name === '.gitkeep')) continue;
    if (keep.has(path.resolve(full))) continue;
    try {
      if (fs.statSync(full).mtimeMs < cutoffMs) {
        fs.rmSync(full, { force: true });
        res.filesDeleted++;
        remaining--;
      }
    } catch {
      /* in use or gone */
    }
  }
  if (!isRoot && remaining === 0) {
    try {
      fs.rmdirSync(dir);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Removes finished runs (with their logs and screenshots), old audit events and read notifications
 * older than Settings.logRetentionHours. Running jobs and platform data (e.g. Naukri's shared-jobs
 * history, which prevents duplicate applications) are never touched.
 */
export function cleanupOldData(db: AppDatabase, logsDir: string, now = Date.now()): CleanupResult | null {
  const hours = db.settings.get().logRetentionHours;
  if (!hours) return null;
  const cutoffMs = now - hours * 3_600_000;
  const cutoff = new Date(cutoffMs).toISOString();
  const res: CleanupResult = { runsDeleted: 0, filesDeleted: 0, eventsDeleted: 0, notificationsDeleted: 0 };
  const deleted = db.runs.deleteFinishedBefore(cutoff);
  res.runsDeleted = deleted.count;
  for (const f of deleted.files) {
    try {
      fs.rmSync(f, { force: true });
      res.filesDeleted++;
    } catch {
      /* ignore */
    }
  }
  const keep = new Set(db.runs.referencedFiles().map((f) => path.resolve(f)));
  sweep(logsDir, cutoffMs, keep, res, true);
  res.eventsDeleted = db.events.deleteBefore(cutoff);
  res.notificationsDeleted = db.notifications.deleteBefore(cutoff);
  return res;
}

/** Run once now, then hourly. Returns a stop function. */
export function startRetention(db: AppDatabase, logsDir: string): () => void {
  const run = () => {
    try {
      const r = cleanupOldData(db, logsDir);
      if (r && (r.runsDeleted || r.filesDeleted)) {
        appLogger.info(`Retention: removed ${r.runsDeleted} run(s), ${r.filesDeleted} file(s), ${r.eventsDeleted} event(s)`);
      }
    } catch (err) {
      appLogger.warn(`Retention cleanup failed: ${(err as Error).message}`);
    }
  };
  run();
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
