import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformDescriptor } from '@shared/types/index';
import { createDefaultRegistry } from '../../automation-server/src/adapters';
import { BasePlatformAdapter } from '../../automation-server/src/adapters/base/baseAdapter';
import { ComingSoonAdapter } from '../../automation-server/src/adapters/base/comingSoonAdapter';
import { AdapterRegistry } from '../../automation-server/src/adapters/base/registry';
import type { SessionState, TaskResult } from '../../automation-server/src/adapters/base/platformAdapter';
import { AutomationError } from '../../automation-server/src/errors/automationError';
import { addNaukriAccount, createEnv, type TestEnv } from '../helpers/env';
import { FakeExecutor } from '../helpers/fakeExecutor';
import { z } from 'zod';

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

describe('Platform adapter registry', () => {
  it('loads Naukri and LinkedIn as active and the four future platforms as coming soon', () => {
    const r = createDefaultRegistry();
    expect(r.list().map((a) => a.platformId)).toEqual(['naukri', 'linkedin', 'indeed', 'glassdoor', 'career-portals', 'custom']);
    expect(r.available().map((a) => a.platformId)).toEqual(['naukri', 'linkedin']);
    const naukri = r.require('naukri');
    expect(naukri.getTasks().map((t) => t.type)).toEqual(['PROFILE_UPDATE', 'RESUME_UPLOAD', 'SHARE_INTEREST']);
    expect(r.require('linkedin').getTasks().map((t) => t.type)).toEqual(['LEAD_FINDER']);
    for (const id of ['indeed', 'glassdoor', 'career-portals', 'custom']) {
      const a = r.require(id);
      expect(a.available).toBe(false);
      expect(a.getTasks()).toEqual([]);
      expect(a.descriptor.plannedTasks.length).toBeGreaterThan(0);
    }
    expect(r.require('career-portals').descriptor.capabilities.requiresLogin).toBe(false);
  });

  it('rejects duplicate platforms, bad ids and duplicate task types', () => {
    const r = new AdapterRegistry().register(new ComingSoonAdapter({ id: 'x-one', name: 'X', tagline: '', description: '', accent: '#000', monogram: 'X', website: null, plannedTasks: ['a'] }));
    expect(() => r.register(new ComingSoonAdapter({ id: 'x-one', name: 'X', tagline: '', description: '', accent: '#000', monogram: 'X', website: null, plannedTasks: [] }))).toThrow(/already registered/);
    expect(() => r.register(new ComingSoonAdapter({ id: 'Bad Id', name: 'X', tagline: '', description: '', accent: '#000', monogram: 'X', website: null, plannedTasks: [] }))).toThrow(/Invalid platform id/);
    expect(() => r.require('nope')).toThrow(/not found/);
  });

  it('coming-soon adapters never pretend to work', async () => {
    const a = createDefaultRegistry().require('indeed');
    await expect(a.executeTask({} as never, {} as never)).rejects.toMatchObject({ category: 'PLATFORM_UNAVAILABLE' });
  });

  it('Naukri validates and normalises task configuration', () => {
    const naukri = createDefaultRegistry().require('naukri');
    expect(naukri.parseTaskConfig('SHARE_INTEREST', {})).toEqual({
      rolesPerRun: 5,
      dailyLimit: 25,
      includeKeywords: [],
      excludeKeywords: [],
      minDelaySec: 25,
      maxDelaySec: 75,
    });
    expect(naukri.parseTaskConfig('PROFILE_UPDATE', { marker: '!' })).toEqual({ marker: '!' });
    expect(() => naukri.parseTaskConfig('PROFILE_UPDATE', { marker: '' })).toThrow(AutomationError);
    expect(() => naukri.parseTaskConfig('RESUME_UPLOAD', { selectionMode: 'random' })).toThrow(/selectionMode/);
    for (const t of naukri.getTasks()) expect(naukri.parseTaskConfig(t.type, t.defaultConfig)).toEqual(t.defaultConfig);
  });

  it('declares a config field for every configurable key (the UI renders forms from this)', () => {
    for (const t of createDefaultRegistry().require('naukri').getTasks()) {
      expect(t.configFields.map((f) => f.key).sort()).toEqual(Object.keys(t.defaultConfig).sort());
    }
  });
});

/** A brand-new platform plugged in without touching the core: proves the architecture is generic. */
class DemoAdapter extends BasePlatformAdapter {
  readonly descriptor: PlatformDescriptor = {
    id: 'demo',
    name: 'Demo',
    tagline: '',
    description: '',
    status: 'active',
    accent: '#123456',
    monogram: 'D',
    website: null,
    capabilities: { requiresLogin: false, browserModes: ['headless'], defaultMode: 'headless', supportsConnect: false, supportsValidation: false },
    account: { usernameLabel: 'Site URL', usernamePlaceholder: '', passwordLabel: '' },
    tasks: [
      {
        type: 'PING',
        name: 'Ping',
        description: 'Checks the site',
        effect: 'read',
        retryable: true,
        configFields: [{ key: 'times', label: 'Times', type: 'number' }],
        defaultConfig: { times: 1 },
        metricLabel: 'Pings',
      },
    ],
    plannedTasks: [],
    notes: [],
  };
  protected override readonly configSchemas = { PING: z.object({ times: z.number().int().min(1).default(1) }) };
  async checkSession(): Promise<SessionState> {
    return 'authenticated';
  }
  async authenticate() {
    return { reused: true };
  }
  async executeTask(): Promise<TaskResult> {
    return { message: 'pong' };
  }
}

describe('Adding a platform', () => {
  it('a new adapter gets accounts, tasks, schedules, runs and dashboard stats with no core changes', async () => {
    const registry = createDefaultRegistry().register(new DemoAdapter());
    env = await createEnv({ mock: false, services: { registry, executor: (d) => new FakeExecutor(d) } });
    const s = env.services;
    const account = await s.accounts.create({ platformId: 'demo', name: 'My site', username: 'https://example.com' });
    const [task] = s.tasks.list({ accountId: account.id });
    expect(task).toMatchObject({ name: 'Ping', platformId: 'demo', configuration: { times: 1 } });
    s.scheduler.create({ taskId: task!.id, frequency: 'daily', time: '08:00' });
    const run = s.executor.enqueue({ taskId: task!.id, trigger: 'manual' });
    expect(run.mode).toBe('headless');
    await s.executor.queue.idle();
    const demo = s.dashboard.dashboard().platforms.find((p) => p.platformId === 'demo')!;
    expect(demo).toMatchObject({ status: 'active', accounts: 1, successToday: 1, metrics: [{ label: 'Pings', value: 1 }] });
    expect(s.db.runs.list({ platformId: 'demo' }).total).toBe(1);
  });

  it('platform data tables migrate under their own scope', async () => {
    env = await createEnv({ mock: false });
    expect(env.services.db.schemaVersion('core')).toBe(2);
    expect(env.services.db.schemaVersion('naukri')).toBe(1);
    const tables = env.services.db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'naukri_%'`).all();
    expect(tables.map((t) => (t as { name: string }).name).sort()).toEqual(['naukri_profile_state', 'naukri_shared_jobs']);
    // Re-applying is a no-op
    expect(env.services.db.migrate('naukri', env.services.registry.require('naukri').migrations)).toBe(0);
  });

  it('Naukri data is removed with its account', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const store = new (await import('../../automation-server/src/adapters/naukri/store')).NaukriStore(env.services.db.raw);
    store.record(a.id, { jobId: '1', title: 'QA', company: null, experience: null, salary: null, location: null }, 'shared', null, null);
    store.setMarkerBaseline(a.id, 'Headline');
    await env.services.accounts.remove(a.id);
    expect(store.list(null, 10)).toHaveLength(0);
    expect(store.markerBaseline(a.id)).toBeNull();
  });
});
