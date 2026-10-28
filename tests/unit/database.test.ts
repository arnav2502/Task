import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../../automation-server/src/database/database';
import { formatRunId } from '../../automation-server/src/database/repositories/runs';
import { cleanupOldData } from '../../automation-server/src/logging/retention';
import { NaukriStore } from '../../automation-server/src/adapters/naukri/store';
import { buildTimeline } from '../../automation-server/src/server/dashboardService';
import { addNaukriAccount, createEnv, makeTempDir, taskOf, type TestEnv } from '../helpers/env';
import { fakeServices } from '../helpers/fakeExecutor';

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

describe('Database', () => {
  it('migrations are idempotent across restarts and settings merge over defaults', () => {
    const file = path.join(makeTempDir('db'), 'taskpilot.sqlite');
    const db1 = new AppDatabase(file);
    db1.settings.save({ maxConcurrent: 4, displayName: 'Arnav' });
    db1.close();
    const db2 = new AppDatabase(file);
    expect(db2.schemaVersion('core')).toBe(2);
    expect(db2.settings.get()).toMatchObject({ maxConcurrent: 4, displayName: 'Arnav', defaultMode: 'background', missedPolicy: 'run' });
    db2.close();
  });

  it('formats run ids as RUN-YYYYMMDD-NNNNNN', () => {
    expect(formatRunId(123, new Date(2026, 9, 26))).toBe('RUN-20261026-000123');
  });

  it('cancels runs orphaned by a crash on start-up', async () => {
    env = await createEnv({ mock: false, services: fakeServices() });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const run = env.services.db.runs.insert({
      platformId: 'naukri',
      accountId: a.id,
      accountName: 'A',
      taskId: taskOf(env, a.id).id,
      taskType: 'PROFILE_UPDATE',
      taskName: 'Profile Update',
      scheduleId: null,
      trigger: 'manual',
      status: 'running',
      mode: 'headless',
      priority: 100,
      maxAttempts: 1,
    });
    expect(env.services.db.runs.cancelOrphaned()).toBe(1);
    expect(env.services.db.runs.get(run.id)).toMatchObject({ status: 'cancelled', errorCode: 'CANCELLED' });
  });

  it('retention removes old runs and their files but never Naukri shared-jobs history', async () => {
    env = await createEnv({ mock: false, services: fakeServices(), settings: { logRetentionHours: 24 } });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const done = await env.services.executor.waitFor(env.services.executor.enqueue({ taskId: taskOf(env, a.id).id, trigger: 'manual' }).id, 10_000);
    const logFile = env.services.db.runs.get(done.id)!.logPath!;
    expect(fs.existsSync(logFile)).toBe(true);
    new NaukriStore(env.services.db.raw).record(a.id, { jobId: '9', title: 'QA', company: null, experience: null, salary: null, location: null }, 'shared', null, done.id);

    // Not old yet → kept
    expect(cleanupOldData(env.services.db, env.config.logsDir)?.runsDeleted).toBe(0);
    // Two days later → removed
    const later = Date.now() + 48 * 3_600_000;
    env.services.db.raw.prepare('UPDATE execution_runs SET queued_at = ?').run(new Date(Date.now() - 48 * 3_600_000).toISOString());
    const res = cleanupOldData(env.services.db, env.config.logsDir, later)!;
    expect(res.runsDeleted).toBe(1);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(env.services.db.runs.logs(done.id)).toHaveLength(0);
    expect(new NaukriStore(env.services.db.raw).list(a.id, 10)).toHaveLength(1);
  });

  it('builds a failed timeline that marks the stage where it stopped', () => {
    const t0 = '2026-10-26T10:00:00.000Z';
    const t1 = '2026-10-26T10:00:05.000Z';
    const run = { status: 'failed', stage: 'COMPLETED', startedAt: t0, completedAt: t1 } as Parameters<typeof buildTimeline>[0];
    const logs = [
      { id: 1, runId: 'r', ts: t0, level: 'info' as const, stage: 'STARTED' as const, message: '' },
      { id: 2, runId: 'r', ts: t0, level: 'info' as const, stage: 'LOGIN_CHECK' as const, message: '' },
      { id: 3, runId: 'r', ts: t1, level: 'error' as const, stage: 'COMPLETED' as const, message: '' },
    ];
    expect(buildTimeline(run, logs).map((e) => `${e.stage}:${e.state}`)).toEqual([
      'STARTED:done',
      'LOGIN_CHECK:failed',
      'TASK_EXECUTION:skipped',
      'VERIFICATION:skipped',
      'COMPLETED:failed',
    ]);
  });
});

describe('Core migration v2 (task table rebuild)', () => {
  it('keeps existing tasks, schedules and task configs when upgrading a v1 database', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { CORE_MIGRATIONS } = await import('../../automation-server/src/database/coreMigrations');
    const file = path.join(makeTempDir('upgrade'), 'taskpilot.sqlite');
    // Build a v1 database with data, as an existing install would have it.
    const v1 = new Database(file);
    v1.pragma('foreign_keys = ON');
    v1.exec(`CREATE TABLE schema_migrations (scope TEXT NOT NULL, version INTEGER NOT NULL, description TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (scope, version))`);
    v1.exec(CORE_MIGRATIONS[0]!.up);
    v1.prepare(`INSERT INTO schema_migrations VALUES ('core', 1, 'v1', 'x')`).run();
    const now = new Date().toISOString();
    v1.prepare(`INSERT INTO platforms VALUES ('naukri','Naukri','active',1,?,?)`).run(now, now);
    v1.prepare(`INSERT INTO accounts (id, platform_id, name, username, created_at, updated_at) VALUES ('a1','naukri','A','a@x.com',?,?)`).run(now, now);
    v1.prepare(`INSERT INTO tasks (id, platform_id, account_id, task_type, success_count, created_at, updated_at) VALUES ('t1','naukri','a1','PROFILE_UPDATE',7,?,?)`).run(now, now);
    v1.prepare(
      `INSERT INTO schedules (id, platform_id, account_id, task_id, task_type, frequency, time, created_at, updated_at) VALUES ('s1','naukri','a1','t1','PROFILE_UPDATE','daily','09:00',?,?)`,
    ).run(now, now);
    v1.prepare(`INSERT INTO task_configs (platform_id, task_type, account_id, config, updated_at) VALUES ('naukri','PROFILE_UPDATE','a1','{"marker":"!"}',?)`).run(now);
    v1.close();

    const db = new AppDatabase(file);
    expect(db.schemaVersion('core')).toBe(2);
    expect(db.tasks.get('t1')).toMatchObject({ successCount: 7, name: null });
    expect(db.schedules.get('s1')).toMatchObject({ taskId: 't1' });
    expect(db.tasks.getConfig('naukri', 'PROFILE_UPDATE', 'a1')).toEqual({ marker: '!' });
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    // Singleton uniqueness still holds; named instances are free.
    db.tasks.ensure([{ id: 't2', platformId: 'naukri', accountId: 'a1', taskType: 'PROFILE_UPDATE', enabled: true }]);
    expect(db.tasks.list({ accountId: 'a1' })).toHaveLength(1);
    db.tasks.insertInstance({ id: 't3', platformId: 'naukri', accountId: 'a1', taskType: 'PROFILE_UPDATE', name: 'Second', enabled: true });
    expect(db.tasks.list({ accountId: 'a1' })).toHaveLength(2);
    // Deleting the account still cascades through the rebuilt table.
    db.accounts.delete('a1');
    expect(db.tasks.list({})).toHaveLength(0);
    expect(db.schedules.list()).toHaveLength(0);
    db.close();
  });
});
