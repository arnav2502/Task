/**
 * Domain types shared by the automation service and the extension.
 *
 * Everything here is platform-agnostic. A platform (Naukri, LinkedIn, …) describes itself with a
 * PlatformDescriptor and its tasks with TaskTypeDescriptors; the dashboard renders from those, so a
 * new platform needs no changes here.
 */
import type {
  ACCOUNT_STATUSES,
  BROWSER_MODES,
  ERROR_CODES,
  LOG_LEVELS,
  TASK_STATES,
  MISSED_POLICIES,
  NOTIFICATION_TYPES,
  PLATFORM_STATUSES,
  RUN_STAGES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_MODES,
} from '../constants/index.js';

export type PlatformId = string;
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number];
export type BrowserMode = (typeof BROWSER_MODES)[number];
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunStage = (typeof RUN_STAGES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export type MissedPolicy = (typeof MISSED_POLICIES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type CredentialBackend = 'keyring' | 'vault';

// ------------------------------------------------------------------ platforms

/** Declarative description of one configuration field, so the UI can render task settings generically. */
export type ConfigField = {
  key: string;
  label: string;
  help?: string;
} & (
  | { type: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { type: 'boolean' }
  | { type: 'text'; placeholder?: string; maxLength?: number }
  | { type: 'tags'; placeholder?: string }
  | { type: 'select'; options: Array<{ value: string; label: string }> }
  /** A folder on this computer, with a native "Browse…" picker. */
  | { type: 'folder' }
);

/**
 * - read: only reads the site
 * - update: changes the user's own data (e.g. profile)
 * - apply: submits something on the user's behalf (e.g. a job application) — the UI warns about it
 */
export type TaskEffect = 'read' | 'update' | 'apply';

export interface TaskTypeDescriptor {
  /** Stable identifier, e.g. PROFILE_UPDATE. Unique within a platform. */
  type: string;
  name: string;
  description: string;
  effect: TaskEffect;
  /** Retry temporary failures inside the same run. False when a retry could duplicate a side effect. */
  retryable: boolean;
  configFields: ConfigField[];
  defaultConfig: Record<string, unknown>;
  /** Label for the dashboard metric counting today's successful runs (e.g. "Profile updates"). */
  metricLabel?: string;
  /** Notification texts. */
  notify?: { success?: string; failure?: string };
  /** Suggested schedules shown as one-click presets. */
  schedulePresets?: SchedulePreset[];
  /**
   * Several named instances per account (e.g. LinkedIn lead searches "Find QA Recruiters",
   * "Find Hiring Managers"), each with its own configuration and schedules. Created by the user via
   * POST /tasks; not auto-created with the account.
   */
  multiInstance?: boolean;
}

export interface PlatformCapabilities {
  /** The platform needs a username/password (career-portal monitoring, for example, may not). */
  requiresLogin: boolean;
  browserModes: BrowserMode[];
  defaultMode: BrowserMode;
  /** "Connect" opens a visible browser for manual sign-in / OTP. */
  supportsConnect: boolean;
  /** Read-only selector health check. */
  supportsValidation: boolean;
}

export interface PlatformDescriptor {
  id: PlatformId;
  name: string;
  tagline: string;
  description: string;
  status: PlatformStatus;
  /** Brand accent colour (hex) used for the platform tile. */
  accent: string;
  /** Two-letter monogram shown in the platform tile. */
  monogram: string;
  website: string | null;
  capabilities: PlatformCapabilities;
  account: { usernameLabel: string; usernamePlaceholder: string; passwordLabel: string };
  tasks: TaskTypeDescriptor[];
  /** For platforms that are not available yet: what they will be able to do. */
  plannedTasks: string[];
  /** Important platform facts shown to the user (limits, known blocks …). */
  notes: string[];
}

export interface PlatformMetric {
  key: string;
  label: string;
  value: number | string;
  hint?: string;
}

// ------------------------------------------------------------------- accounts

export interface Account {
  id: string;
  platformId: PlatformId;
  name: string;
  /** Always masked when sent to the extension (arna********@gmail.com). */
  username: string;
  status: AccountStatus;
  statusMessage: string | null;
  /** Scheduled automation on/off for this account. Manual runs are always allowed. */
  enabled: boolean;
  modeOverride: BrowserMode | null;
  hasCredentials: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSummary extends Account {
  activeRun: ExecutionRun | null;
  nextRunAt: string | null;
  taskCount: number;
  enabledTaskCount: number;
}

// ---------------------------------------------------------------------- tasks

export type TaskLiveStatus = 'idle' | 'queued' | 'running' | 'success' | 'waiting_for_review' | 'failed' | 'action_required' | 'cancelled' | 'skipped';

/** A task instance: one task type of one platform, for one account. */
export interface Task {
  id: string;
  platformId: PlatformId;
  accountId: string;
  accountName: string;
  taskType: string;
  /** The instance name for multi-instance tasks (e.g. "Find QA Recruiters"), else the task type's name. */
  name: string;
  /** Name of the task type (e.g. "Lead Finder"). */
  typeName: string;
  multiInstance: boolean;
  description: string;
  effect: TaskEffect;
  /** Lifecycle state: DRAFT · SCHEDULED · RUNNING · WAITING_FOR_REVIEW · COMPLETED · FAILED · CANCELLED. */
  state: TaskState;
  /** Items prepared by the last run that still need a person's review (0 when none). */
  pendingReview: number;
  /** Scheduled runs on/off. Manual "Run now" always works. */
  enabled: boolean;
  /** Effective configuration (task-type defaults ← platform defaults ← this account's override). */
  configuration: Record<string, unknown>;
  hasConfigOverride: boolean;
  status: TaskLiveStatus;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: RunStatus | null;
  lastError: string | null;
  nextRunAt: string | null;
  scheduleCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ schedules

export interface Schedule {
  id: string;
  platformId: PlatformId;
  accountId: string;
  taskId: string;
  taskType: string;
  frequency: ScheduleFrequency;
  /** HH:mm (24 h). For hourly windows: the window start. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: number[];
  /** YYYY-MM-DD, only for "once". */
  onceDate: string | null;
  /** HH:mm, only for "hourly": last hour of the window (inclusive). */
  windowEnd: string | null;
  /** Hourly only: fresh random minute (1–59) for every run. */
  randomMinute: boolean;
  mode: ScheduleMode;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** Human-readable, e.g. "Hourly 7 AM–11 PM daily, random minute". */
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulePreset {
  label: string;
  frequency: ScheduleFrequency;
  time: string;
  daysOfWeek?: number[];
  windowEnd?: string;
  randomMinute?: boolean;
}

// ----------------------------------------------------------------------- runs

export interface ExecutionRun {
  /** Human-readable id, e.g. RUN-20261026-000123. */
  id: string;
  platformId: PlatformId;
  accountId: string;
  accountName: string;
  taskId: string | null;
  taskType: string;
  taskName: string;
  scheduleId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  mode: BrowserMode;
  priority: number;
  stage: RunStage | null;
  currentStep: string | null;
  attempt: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  error: string | null;
  resultMessage: string | null;
  /** Structured result from the adapter (e.g. { shared: 3, failed: 0 }). */
  result: Record<string, unknown> | null;
  hasScreenshot: boolean;
  retryOf: string | null;
  /** Items left for a person to review (status waiting_for_review). */
  reviewCount: number;
}

export interface RunLogLine {
  id: number;
  runId: string;
  ts: string;
  level: LogLevel;
  stage: RunStage | null;
  message: string;
}

export interface TimelineEntry {
  stage: RunStage;
  state: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  startedAt: string | null;
  endedAt: string | null;
}

export interface RunDetails extends ExecutionRun {
  logs: RunLogLine[];
  timeline: TimelineEntry[];
}

export interface RunFilters {
  platformId?: string;
  accountId?: string;
  taskType?: string;
  taskId?: string;
  status?: RunStatus;
  trigger?: RunTrigger;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface RunPage {
  runs: ExecutionRun[];
  total: number;
}

export interface QueueItem {
  runId: string;
  platformId: PlatformId;
  accountId: string;
  accountName: string;
  taskType: string;
  taskName: string;
  status: 'queued' | 'running';
  priority: number;
  /** 1-based position among waiting jobs; null when running. */
  position: number | null;
  queuedAt: string;
  startedAt: string | null;
}

export interface QueueSnapshot {
  running: QueueItem[];
  pending: QueueItem[];
  maxConcurrent: number;
}

// -------------------------------------------------------------- notifications

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  platformId: PlatformId | null;
  accountId: string | null;
  runId: string | null;
  /** Optional in-app destination (hash route), e.g. "#/platforms/linkedin/drafts" for "Review now". */
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface ActivityEvent {
  id: number;
  type: string;
  message: string;
  platformId: PlatformId | null;
  accountId: string | null;
  runId: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------- settings

export interface Settings {
  /** Shown in the dashboard greeting. */
  displayName: string;
  defaultMode: BrowserMode;
  /** Maximum number of accounts running at the same time (one browser per account). */
  maxConcurrent: number;
  missedPolicy: MissedPolicy;
  retryEnabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  taskTimeoutSec: number;
  /** How long a visible (headed) run waits for you to finish an OTP / CAPTCHA. */
  verificationWaitSec: number;
  screenshotOnFailure: boolean;
  screenshotOnSuccess: boolean;
  notifyFailures: boolean;
  notifySuccess: boolean;
  notifyActionRequired: boolean;
  /** Only fire schedules while the extension reports that Chrome is open. */
  requireChromeOpen: boolean;
  /** Delete run logs, screenshots and finished runs older than this (0 = keep forever). */
  logRetentionHours: number;
  setupComplete: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  defaultMode: 'background',
  maxConcurrent: 2,
  missedPolicy: 'run',
  retryEnabled: true,
  maxRetries: 1,
  retryDelaySec: 5,
  taskTimeoutSec: 180,
  verificationWaitSec: 300,
  screenshotOnFailure: true,
  screenshotOnSuccess: true,
  notifyFailures: true,
  notifySuccess: false,
  notifyActionRequired: true,
  requireChromeOpen: false,
  logRetentionHours: 24 * 7,
  setupComplete: false,
};

// ------------------------------------------------------------------ dashboard

export interface PlatformActivity {
  platformId: PlatformId;
  name: string;
  status: PlatformStatus;
  accent: string;
  monogram: string;
  accounts: number;
  connectedAccounts: number;
  tasks: number;
  enabledTasks: number;
  runsToday: number;
  successToday: number;
  failedToday: number;
  /** Success rate over the last 7 days (0–100), null when nothing ran. */
  successRate: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  metrics: PlatformMetric[];
}

export interface UpcomingRun {
  scheduleId: string;
  taskId: string;
  platformId: PlatformId;
  accountName: string;
  taskName: string;
  at: string;
  summary: string;
}

export interface DashboardData {
  displayName: string;
  stats: {
    totalTasks: number;
    enabledTasks: number;
    runningNow: number;
    queued: number;
    successfulToday: number;
    failedToday: number;
    /** Scheduled runs in the next 24 hours. */
    upcoming: number;
    connectedAccounts: number;
    totalAccounts: number;
  };
  platforms: PlatformActivity[];
  recentRuns: ExecutionRun[];
  upcoming: UpcomingRun[];
  queue: QueueSnapshot;
  unreadNotifications: number;
}

// --------------------------------------------------------------------- system

export interface HealthResponse {
  ok: true;
  name: string;
  version: string;
  uptimeSec: number;
  paired: boolean;
  credentialBackend: CredentialBackend;
  platforms: number;
}

export interface ValidationCheck {
  key: string;
  description: string;
  found: boolean;
  matched: string | null;
}

/** Messages pushed over the WebSocket. */
export type LiveMessage =
  | { type: 'run:update'; run: ExecutionRun }
  | { type: 'run:log'; line: RunLogLine }
  | { type: 'account:update'; account: Account }
  | { type: 'account:deleted'; accountId: string }
  | { type: 'tasks:changed'; accountId: string | null }
  | { type: 'schedules:changed' }
  | { type: 'queue:changed'; queue: QueueSnapshot }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'settings:changed'; settings: Settings };

export interface ApiError {
  error: string;
  code?: string;
}
