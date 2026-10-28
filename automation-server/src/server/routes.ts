import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { SYSTEM_TASK_TYPES } from '@shared/constants/index.js';
import {
  accountCreateSchema,
  accountUpdateSchema,
  markNotificationsSchema,
  notificationQuerySchema,
  pickFolderSchema,
  platformTaskDefaultsSchema,
  runFiltersSchema,
  runTaskSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from '@shared/schemas/index.js';
import type { ValidationCheck } from '@shared/types/index.js';
import type { Services } from '../container.js';
import { toPublicAccount } from '../accounts/accountService.js';
import { conflict, notFound } from '../errors/automationError.js';
import { pickFolder } from '../system/folderPicker.js';
import { toPublicRun, type SystemTaskType } from '../tasks/taskExecutor.js';

const qs = (req: Request, key: string) => (typeof req.query[key] === 'string' && req.query[key] ? (req.query[key] as string) : undefined);
const param = (req: Request, key: string) => String(req.params[key]);

/** Generic, platform-independent API. Platform-specific routes are mounted by their adapters. */
export function genericRoutes(s: Services): Router {
  const { db, registry, accounts, tasks, executor, scheduler, dashboard, bus } = s;
  const r = Router();

  // ----------------------------------------------------------------- system
  r.post('/heartbeat', (_req, res) => {
    scheduler.chromeHeartbeat();
    res.json({
      ok: true,
      active: db.runs.active().length,
      unreadNotifications: db.notifications.unreadCount(),
      latestNotificationId: db.notifications.latestId(),
    });
  });
  r.get('/dashboard', (_req, res) => res.json(dashboard.dashboard()));
  r.get('/queue', (_req, res) => res.json(executor.snapshot()));
  r.get('/settings', (_req, res) => res.json(db.settings.get()));
  r.put('/settings', (req, res) => {
    const settings = db.settings.save(settingsUpdateSchema.parse(req.body));
    executor.queue.pump(); // the concurrency limit may have gone up
    bus.publish({ type: 'settings:changed', settings });
    res.json(settings);
  });
  r.get('/events', (req, res) => res.json(db.events.list(Math.min(Number(qs(req, 'limit')) || 100, 500))));
  r.post('/system/pick-folder', async (req, res) => {
    const { initial } = pickFolderSchema.parse(req.body ?? {});
    res.json({ path: await pickFolder(initial) });
  });

  // -------------------------------------------------------------- platforms
  r.get('/platforms', (_req, res) => res.json(registry.list().map((a) => a.descriptor)));
  r.get('/platforms/:id', (req, res) => {
    const adapter = registry.require(param(req, 'id'));
    res.json({ ...adapter.descriptor, activity: dashboard.platformActivity(adapter) });
  });
  r.get('/platforms/:id/tasks/:taskType/config', (req, res) => {
    res.json({ configuration: tasks.platformConfig(param(req, 'id'), param(req, 'taskType')) });
  });
  r.put('/platforms/:id/tasks/:taskType/config', (req, res) => {
    const { configuration } = platformTaskDefaultsSchema.parse(req.body);
    res.json({ configuration: tasks.setPlatformConfig(param(req, 'id'), param(req, 'taskType'), configuration) });
  });

  // --------------------------------------------------------------- accounts
  r.get('/accounts', (req, res) => res.json(dashboard.accountSummaries(qs(req, 'platformId'))));
  r.get('/accounts/:id', (req, res) => res.json(dashboard.accountSummary(param(req, 'id'))));
  r.post('/accounts', async (req, res) => res.status(201).json(toPublicAccount(await accounts.create(accountCreateSchema.parse(req.body)))));
  r.put('/accounts/:id', async (req, res) => res.json(toPublicAccount(await accounts.update(param(req, 'id'), accountUpdateSchema.parse(req.body)))));
  r.delete('/accounts/:id', async (req, res) => {
    const id = param(req, 'id');
    accounts.get(id);
    const release = executor.queue.reserve(id);
    if (!release) throw conflict('This account has a queued or running job — wait for it to finish or cancel it');
    try {
      await accounts.remove(id);
    } finally {
      release();
    }
    res.status(204).end();
  });
  r.post('/accounts/:id/disconnect', async (req, res) => {
    const id = param(req, 'id');
    accounts.get(id);
    const release = executor.queue.reserve(id);
    if (!release) throw conflict('This account is busy — try again when its job has finished');
    try {
      res.json(toPublicAccount(await accounts.disconnect(id)));
    } finally {
      release();
    }
  });
  const system = (type: SystemTaskType) => (req: Request, res: Response) => {
    const { mode } = runTaskSchema.parse(req.body ?? {});
    res.status(202).json(toPublicRun(executor.enqueue({ accountId: param(req, 'id'), systemTask: type, trigger: 'manual', mode })));
  };
  r.post('/accounts/:id/connect', system(SYSTEM_TASK_TYPES.CONNECT));
  r.post('/accounts/:id/test-login', system(SYSTEM_TASK_TYPES.TEST_LOGIN));
  /** Selector health check: queued like any run (history + logs), answered when it finishes. */
  r.post('/accounts/:id/validate', async (req, res) => {
    const run = executor.enqueue({ accountId: param(req, 'id'), systemTask: SYSTEM_TASK_TYPES.VALIDATE, trigger: 'manual' });
    const done = await executor.waitFor(run.id, 5 * 60_000);
    if (done.status !== 'success') throw conflict(done.error ?? 'Validation did not complete', done.errorCode ?? undefined);
    res.json((done.result?.checks as ValidationCheck[] | undefined) ?? []);
  });

  // ------------------------------------------------------------------ tasks
  r.get('/tasks', (req, res) => res.json(tasks.list({ platformId: qs(req, 'platformId'), accountId: qs(req, 'accountId') })));
  r.get('/tasks/:id', (req, res) => res.json(tasks.view(param(req, 'id'))));
  r.post('/tasks', (req, res) => res.status(201).json(tasks.create(taskCreateSchema.parse(req.body))));
  r.put('/tasks/:id', (req, res) => res.json(tasks.update(param(req, 'id'), taskUpdateSchema.parse(req.body))));
  /** Multi-instance tasks only (e.g. a LinkedIn lead search); singleton tasks belong to their account. */
  r.delete('/tasks/:id', (req, res) => {
    tasks.delete(param(req, 'id'), (taskId) => executor.queue.has(taskId));
    res.status(204).end();
  });
  r.post('/tasks/:id/run', (req, res) => {
    const { mode } = runTaskSchema.parse(req.body ?? {});
    res.status(202).json(toPublicRun(executor.enqueue({ taskId: param(req, 'id'), trigger: 'manual', mode })));
  });

  // -------------------------------------------------------------- schedules
  r.get('/schedules', (req, res) =>
    res.json(scheduler.list({ platformId: qs(req, 'platformId'), accountId: qs(req, 'accountId'), taskId: qs(req, 'taskId') })),
  );
  r.post('/schedules', (req, res) => res.status(201).json(scheduler.create(scheduleCreateSchema.parse(req.body))));
  r.put('/schedules/:id', (req, res) => res.json(scheduler.update(param(req, 'id'), scheduleUpdateSchema.parse(req.body))));
  r.delete('/schedules/:id', (req, res) => {
    scheduler.delete(param(req, 'id'));
    res.status(204).end();
  });

  // ------------------------------------------------------------------- runs
  r.get('/runs', (req, res) => {
    const page = db.runs.list(runFiltersSchema.parse(req.query));
    res.json({ runs: page.runs.map(toPublicRun), total: page.total });
  });
  r.get('/runs/:id', (req, res) => res.json(dashboard.runDetails(param(req, 'id'))));
  r.post('/runs/:id/cancel', (req, res) => res.json({ cancelled: executor.cancel(param(req, 'id')) }));
  r.post('/runs/:id/retry', (req, res) => res.status(202).json(toPublicRun(executor.retry(param(req, 'id')))));
  const runFile = (kind: 'screenshotPath' | 'logPath') => (req: Request) => {
    const file = db.runs.get(param(req, 'id'))?.[kind];
    // Only ever serve files from inside the logs folder.
    if (!file || !path.resolve(file).startsWith(path.resolve(s.config.logsDir) + path.sep) || !fs.existsSync(file)) {
      throw notFound(kind === 'logPath' ? 'Log file' : 'Screenshot');
    }
    return path.resolve(file);
  };
  r.get('/runs/:id/screenshot', (req, res) => res.sendFile(runFile('screenshotPath')(req)));
  r.get('/runs/:id/log', (req, res) => res.type('text/plain').send(fs.readFileSync(runFile('logPath')(req), 'utf8')));

  // ---------------------------------------------------------- notifications
  r.get('/notifications', (req, res) => {
    const q = notificationQuerySchema.parse(req.query);
    res.json({
      notifications: db.notifications.list({ unreadOnly: q.unreadOnly, after: q.after, limit: q.limit }),
      unread: db.notifications.unreadCount(),
      latestId: db.notifications.latestId(),
    });
  });
  r.post('/notifications/read', (req, res) => {
    const body = markNotificationsSchema.parse(req.body ?? {});
    db.notifications.markRead(body.all ? 'all' : (body.ids ?? []));
    res.json({ unread: db.notifications.unreadCount() });
  });
  r.delete('/notifications', (_req, res) => {
    db.notifications.clear();
    res.status(204).end();
  });

  return r;
}
