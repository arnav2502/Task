/**
 * Zod schemas for every API input. The service validates every request body / query with these.
 * Task configuration is validated separately by the owning platform adapter.
 */
import { z } from 'zod';
import {
  BROWSER_MODES,
  MISSED_POLICIES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_MODES,
} from '../constants/index.js';

const id = z.string().trim().min(1).max(100);
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm (24 h)');

export const browserModeSchema = z.enum(BROWSER_MODES);
export const scheduleModeSchema = z.enum(SCHEDULE_MODES);

// ------------------------------------------------------------------- accounts
export const accountCreateSchema = z.object({
  platformId: id,
  name: z.string().trim().min(1, 'Account name is required').max(80),
  username: z.string().trim().min(3, 'Username is required').max(200),
  /** Optional only for platforms that do not require a login. */
  password: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  modeOverride: browserModeSchema.nullable().optional(),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(3).max(200).optional(),
  /** Empty / omitted = keep the stored password. */
  password: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  modeOverride: browserModeSchema.nullable().optional(),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

// ---------------------------------------------------------------------- tasks
export const taskUpdateSchema = z.object({
  /** Rename a multi-instance task. */
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  /** Partial override for this account; validated by the platform adapter. */
  configuration: z.record(z.string(), z.unknown()).optional(),
  /** Drop this account's override and fall back to the platform defaults. */
  resetConfiguration: z.boolean().optional(),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

/** Create a named instance of a multi-instance task type (e.g. a LinkedIn lead search). */
export const taskCreateSchema = z.object({
  accountId: id,
  taskType: id,
  name: z.string().trim().min(1, 'Task name is required').max(80),
  configuration: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const platformTaskDefaultsSchema = z.object({
  configuration: z.record(z.string(), z.unknown()),
});

export const runTaskSchema = z.object({
  mode: scheduleModeSchema.optional(),
});

// ------------------------------------------------------------------ schedules
const scheduleFields = {
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  time: hhmm,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  onceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
    .nullable()
    .optional(),
  windowEnd: hhmm.nullable().optional(),
  randomMinute: z.boolean().optional(),
  mode: scheduleModeSchema.optional(),
  enabled: z.boolean().optional(),
};

export const scheduleCreateSchema = z.object({ taskId: id, ...scheduleFields });
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;

export const scheduleUpdateSchema = z.object(scheduleFields).partial();
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;

// ----------------------------------------------------------------------- runs
const optionalQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : v), schema.optional());

export const runFiltersSchema = z.object({
  platformId: optionalQuery(id),
  accountId: optionalQuery(id),
  taskType: optionalQuery(id),
  taskId: optionalQuery(id),
  status: optionalQuery(z.enum(RUN_STATUSES)),
  trigger: optionalQuery(z.enum(RUN_TRIGGERS)),
  from: optionalQuery(z.string().datetime({ offset: true })),
  to: optionalQuery(z.string().datetime({ offset: true })),
  limit: optionalQuery(z.coerce.number().int().min(1).max(500)),
  offset: optionalQuery(z.coerce.number().int().min(0)),
});

// ------------------------------------------------------------------- settings
export const settingsUpdateSchema = z
  .object({
    displayName: z.string().trim().max(60),
    defaultMode: browserModeSchema,
    maxConcurrent: z.number().int().min(1).max(10),
    missedPolicy: z.enum(MISSED_POLICIES),
    retryEnabled: z.boolean(),
    maxRetries: z.number().int().min(0).max(5),
    retryDelaySec: z.number().int().min(0).max(600),
    taskTimeoutSec: z.number().int().min(30).max(3600),
    verificationWaitSec: z.number().int().min(30).max(3600),
    screenshotOnFailure: z.boolean(),
    screenshotOnSuccess: z.boolean(),
    notifyFailures: z.boolean(),
    notifySuccess: z.boolean(),
    notifyActionRequired: z.boolean(),
    requireChromeOpen: z.boolean(),
    logRetentionHours: z.number().int().min(0).max(24 * 365),
    setupComplete: z.boolean(),
  })
  .partial()
  .strict();

// -------------------------------------------------------------- notifications
export const notificationQuerySchema = z.object({
  unreadOnly: optionalQuery(z.enum(['true', 'false']).transform((v) => v === 'true')),
  after: optionalQuery(z.coerce.number().int().min(0)),
  limit: optionalQuery(z.coerce.number().int().min(1).max(500)),
});

export const markNotificationsSchema = z.object({
  ids: z.array(z.number().int()).max(1000).optional(),
  all: z.boolean().optional(),
});

// --------------------------------------------------------------------- system
export const pickFolderSchema = z.object({ initial: z.string().max(1000).optional() });
