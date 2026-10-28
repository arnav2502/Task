import { Router } from 'express';
import { z } from 'zod';
import { NAUKRI_TASKS, type ResumeUploadConfig, type SharedJobsResponse } from '@shared/types/naukri.js';
import type { AppDatabase } from '../../database/database.js';
import { notFound } from '../../errors/automationError.js';
import { scanResumeFolder } from './resumeFiles.js';
import type { NaukriStore } from './store.js';

const scanBody = z.object({
  folderPath: z.string().trim().max(1000),
  selectionMode: z.enum(['latest', 'specific']).default('latest'),
  specificFile: z.string().trim().max(260).nullable().optional(),
});

/** Naukri-only routes, mounted at /platforms/naukri (behind the same auth as everything else). */
export function naukriRoutes(opts: {
  db: AppDatabase;
  store: NaukriStore;
  resolveConfig: (taskType: string, accountId: string | null) => Record<string, unknown>;
}): Router {
  const { db, store, resolveConfig } = opts;
  const r = Router();
  const requireAccount = (id: string) => {
    const a = db.accounts.get(id);
    if (!a || a.platformId !== 'naukri') throw notFound('Naukri account');
    return a;
  };

  /** Effective resume folder for an account (its override, else the platform default), scanned now. */
  r.get('/resume/scan', async (req, res) => {
    const accountId = typeof req.query.accountId === 'string' && req.query.accountId ? req.query.accountId : null;
    if (accountId) requireAccount(accountId);
    const cfg = resolveConfig(NAUKRI_TASKS.RESUME_UPLOAD, accountId) as unknown as ResumeUploadConfig;
    res.json(await scanResumeFolder(cfg));
  });

  /** Preview a folder before saving it. */
  r.post('/resume/scan', async (req, res) => {
    const body = scanBody.parse(req.body);
    res.json(await scanResumeFolder({ folderPath: body.folderPath, selectionMode: body.selectionMode, specificFile: body.specificFile ?? '' }));
  });

  r.get('/shared-jobs', (req, res) => {
    const accountId = typeof req.query.accountId === 'string' && req.query.accountId ? req.query.accountId : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const body: SharedJobsResponse = { jobs: store.list(accountId, limit), sharedToday: store.sharedTodayByAccount(start.toISOString()) };
    res.json(body);
  });

  /** Forget the learned headline baseline; the next Profile Update re-learns it from the live text. */
  r.post('/accounts/:id/reset-baseline', (req, res) => {
    requireAccount(String(req.params.id));
    store.setMarkerBaseline(String(req.params.id), null);
    res.status(204).end();
  });

  return r;
}
