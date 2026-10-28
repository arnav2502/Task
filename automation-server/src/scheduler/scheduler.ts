import { randomUUID } from 'node:crypto';
import type { Schedule } from '@shared/types/index.js';
import type { ScheduleCreateInput, ScheduleUpdateInput } from '@shared/schemas/index.js';
import type { AppDatabase } from '../database/database.js';
import type { ScheduleRecord } from '../database/repositories/schedules.js';
import { HttpError, badRequest, notFound } from '../errors/automationError.js';
import type { EventBus } from '../events/eventBus.js';
import { appLogger } from '../logging/logger.js';
import type { NotificationService } from '../notifications/notificationService.js';
import type { TaskExecutor } from '../tasks/taskExecutor.js';
import type { TaskService } from '../tasks/taskService.js';
import { computeNextRun, describeSchedule, formatTime, validateSchedule, type Rng, defaultRng } from './scheduleMath.js';

/** A due schedule more than this late counts as missed (service off / computer asleep). */
export const MISSED_GRACE_MS = 2 * 60_000;
/** A missed run that will still run waits a random 2–6 min (Wi-Fi reconnects, no burst on wake). */
export const MISSED_RUN_DELAY_MS: [number, number] = [2 * 60_000, 6 * 60_000];
/** The extension pings every 30 s; 3 minutes without one = Chrome is closed. */
const CHROME_HEARTBEAT_TTL_MS = 3 * 60_000;

export const toSchedule = (s: ScheduleRecord): Schedule => ({ ...s, summary: describeSchedule(s) });

/**
 * One scheduler for every platform. It references tasks only by id, so it works for any
 * platform's tasks unchanged. Owned by the service (not the extension), so schedules fire whether
 * or not the dashboard is open; each schedule stores its own nextRunAt, which is what makes
 * missed-run detection after a shutdown possible.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastChromeHeartbeat = 0;
  private gateLogged = false;
  private ticking = false;
  private readonly deferredMissed = new Set<string>();
  missedRunDelayMs: [number, number] = MISSED_RUN_DELAY_MS;

  constructor(
    private readonly db: AppDatabase,
    private readonly tasks: TaskService,
    private readonly executor: TaskExecutor,
    private readonly bus: EventBus,
    private readonly notifications: NotificationService,
    private readonly tickMs = 15_000,
    private readonly rng: Rng = defaultRng,
  ) {}

  start() {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  chromeHeartbeat() {
    this.lastChromeHeartbeat = Date.now();
  }

  get chromeConnected() {
    return Date.now() - this.lastChromeHeartbeat < CHROME_HEARTBEAT_TTL_MS;
  }

  // ---------------------------------------------------------------------- CRUD
  list(filter: { platformId?: string; accountId?: string; taskId?: string } = {}): Schedule[] {
    return this.db.schedules.list(filter).map(toSchedule);
  }

  create(input: ScheduleCreateInput, now = new Date()): Schedule {
    const task = this.tasks.record(input.taskId);
    const fields = this.normalise(input);
    const s = this.db.schedules.upsert({
      id: randomUUID(),
      platformId: task.platformId,
      accountId: task.accountId,
      taskId: task.id,
      taskType: task.taskType,
      ...fields,
      nextRunAt: fields.enabled ? (computeNextRun(fields, now, this.rng)?.toISOString() ?? null) : null,
      lastRunAt: null,
    });
    this.changed(task.accountId);
    return toSchedule(s);
  }

  update(id: string, input: ScheduleUpdateInput, now = new Date()): Schedule {
    const existing = this.db.schedules.get(id);
    if (!existing) throw notFound('Schedule');
    const fields = this.normalise({ ...existing, ...input });
    const s = this.db.schedules.upsert({
      ...existing,
      ...fields,
      nextRunAt: fields.enabled ? (computeNextRun(fields, now, this.rng)?.toISOString() ?? null) : null,
    });
    this.changed(existing.accountId);
    return toSchedule(s);
  }

  delete(id: string) {
    const existing = this.db.schedules.get(id);
    if (!existing || !this.db.schedules.delete(id)) throw notFound('Schedule');
    this.changed(existing.accountId);
  }

  private changed(accountId: string) {
    this.bus.publish({ type: 'schedules:changed' });
    this.bus.publish({ type: 'tasks:changed', accountId });
  }

  private normalise(input: ScheduleUpdateInput & Pick<ScheduleCreateInput, 'frequency' | 'time'>) {
    const shape = {
      frequency: input.frequency,
      time: input.time,
      daysOfWeek: [...new Set(input.daysOfWeek ?? [])].sort((a, b) => a - b),
      onceDate: input.frequency === 'once' ? (input.onceDate ?? null) : null,
      windowEnd: input.frequency === 'hourly' ? (input.windowEnd ?? null) : null,
      randomMinute: input.frequency === 'hourly' ? (input.randomMinute ?? true) : false,
    };
    const err = validateSchedule(shape);
    if (err) throw badRequest(err);
    const fields = {
      ...shape,
      time: formatTime(shape.time),
      windowEnd: shape.windowEnd ? formatTime(shape.windowEnd) : null,
      mode: input.mode ?? 'default',
      enabled: input.enabled ?? true,
    };
    if (fields.enabled && fields.frequency === 'once' && !computeNextRun(fields, new Date(), this.rng)) {
      throw badRequest('That date and time is already in the past');
    }
    return fields;
  }

  // ---------------------------------------------------------------------- tick
  tick(now = new Date()): void {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = this.db.settings.get();
      if (settings.requireChromeOpen && !this.chromeConnected) {
        if (!this.gateLogged) appLogger.info('Scheduler paused: "Run only while Chrome is open" is on and Chrome is not connected');
        this.gateLogged = true;
        return;
      }
      this.gateLogged = false;
      for (const s of this.db.schedules.list()) {
        if (!s.enabled) continue;
        if (!s.nextRunAt) {
          const next = computeNextRun(s, now, this.rng);
          if (next) this.db.schedules.upsert({ ...s, nextRunAt: next.toISOString() });
          continue;
        }
        const due = Date.parse(s.nextRunAt);
        if (due > now.getTime()) continue;
        const missed = now.getTime() - due > MISSED_GRACE_MS;
        if (missed && settings.missedPolicy === 'run' && this.missedRunDelayMs[1] > 0 && !this.deferredMissed.has(s.id)) {
          this.deferMissed(s, now);
          continue;
        }
        const wasDeferred = this.deferredMissed.delete(s.id);
        this.fire(s, now, missed || wasDeferred, settings.missedPolicy);
      }
    } finally {
      this.ticking = false;
    }
  }

  private deferMissed(s: ScheduleRecord, now: Date) {
    const [lo, hi] = this.missedRunDelayMs;
    const delay = Math.round(lo + Math.random() * (hi - lo));
    const at = new Date(now.getTime() + delay);
    this.deferredMissed.add(s.id);
    this.db.schedules.upsert({ ...s, nextRunAt: at.toISOString() });
    this.bus.publish({ type: 'schedules:changed' });
    this.notifications.event(
      'schedule.missed',
      `Missed ${s.taskType} run (service was off or the computer was asleep) — starting at ${at.toLocaleTimeString('en-IN')}`,
      { platformId: s.platformId, accountId: s.accountId },
    );
  }

  private fire(s: ScheduleRecord, now: Date, missed: boolean, policy: 'run' | 'skip') {
    const task = this.db.tasks.get(s.taskId);
    const account = this.db.accounts.get(s.accountId);
    try {
      if (!task || !account) return;
      if (!account.enabled || !task.enabled) {
        appLogger.info(`Schedule ${describeSchedule(s)} for ${account.name} skipped — ${!account.enabled ? 'account' : 'task'} automation is paused`);
      } else if (missed && policy === 'skip') {
        this.executor.recordSkipped(
          task,
          'missed',
          s.id,
          `Missed the run scheduled for ${new Date(s.nextRunAt!).toLocaleString('en-IN')} (service was not running) — skipped per the "Missed schedules" setting`,
        );
      } else {
        this.executor.enqueue({ taskId: task.id, trigger: missed ? 'missed' : 'schedule', scheduleId: s.id, mode: s.mode });
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 409 && task) {
        this.executor.recordSkipped(task, 'schedule', s.id, `Skipped: ${err.message}`);
      } else {
        appLogger.error(`Schedule ${s.id} failed to fire: ${(err as Error).message}`);
      }
    } finally {
      // Hourly: continue from the end of this hour so the same slot never runs twice.
      // (end of the due slot's hour, or now if later — a slow tick must not skip the following hour).
      const due = new Date(s.nextRunAt ?? now);
      const slotEnd = new Date(due.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), 59, 59, 999);
      const from = s.frequency === 'hourly' && slotEnd > now ? slotEnd : now;
      const next = s.frequency === 'once' ? null : computeNextRun(s, from, this.rng);
      this.db.schedules.upsert({
        ...s,
        lastRunAt: now.toISOString(),
        nextRunAt: next?.toISOString() ?? null,
        enabled: s.frequency === 'once' ? false : s.enabled,
      });
      this.bus.publish({ type: 'schedules:changed' });
      if (task) this.bus.publish({ type: 'tasks:changed', accountId: task.accountId });
    }
  }
}
