/**
 * Constants shared by the automation service and the extension.
 * Platform-agnostic: nothing in here knows about a specific website.
 */

export const APP_NAME = 'TaskPilot';
export const APP_VERSION = '0.1.0';
/** Default local API port. Deliberately not 47321 so TaskPilot can run next to the older Naukri Tasker. */
export const DEFAULT_PORT = 47400;
export const DEFAULT_SERVICE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/** Ids of the platforms TaskPilot knows about. New platforms add an id here and an adapter on the service. */
export const PLATFORM_IDS = {
  NAUKRI: 'naukri',
  LINKEDIN: 'linkedin',
  INDEED: 'indeed',
  GLASSDOOR: 'glassdoor',
  CAREER_PORTALS: 'career-portals',
  CUSTOM: 'custom',
} as const;

export const PLATFORM_STATUSES = ['active', 'coming_soon'] as const;

/**
 * How the account's browser runs.
 * - background: a real headed browser whose window is hidden (Windows) or minimized (elsewhere)
 * - headed: a normal visible window
 * - headless: true headless (some sites, e.g. Naukri, block it)
 */
export const BROWSER_MODES = ['background', 'headed', 'headless'] as const;
/** "default" = account override → global default. */
export const SCHEDULE_MODES = ['default', ...BROWSER_MODES] as const;

export const ACCOUNT_STATUSES = [
  'unknown',
  'connected',
  'disconnected',
  'auth_required',
  'login_failed',
  'action_required',
  'blocked',
] as const;

/**
 * waiting_for_review: the run finished its automated part and prepared items that a person must review
 * (e.g. LinkedIn connection candidates). Terminal for the run; the task stays WAITING_FOR_REVIEW
 * until the items are handled.
 */
export const RUN_STATUSES = ['queued', 'running', 'success', 'waiting_for_review', 'failed', 'action_required', 'cancelled', 'skipped'] as const;

/** Lifecycle of a task instance, derived from its runs, schedules and pending reviews. */
export const TASK_STATES = ['DRAFT', 'SCHEDULED', 'RUNNING', 'WAITING_FOR_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;
export const RUN_TRIGGERS = ['manual', 'schedule', 'missed', 'retry'] as const;

/** Every run moves through these stages; they form the timeline shown in Run Details. */
export const RUN_STAGES = ['STARTED', 'LOGIN_CHECK', 'TASK_EXECUTION', 'VERIFICATION', 'COMPLETED'] as const;

export const LOG_LEVELS = ['debug', 'info', 'success', 'warn', 'error'] as const;

/**
 * Account-level operations every platform supports. They run through the same queue and history as
 * regular tasks, but are not task instances (no schedule, no configuration).
 */
export const SYSTEM_TASK_TYPES = {
  CONNECT: 'CONNECT',
  TEST_LOGIN: 'TEST_LOGIN',
  /** Read-only selector health check. */
  VALIDATE: 'VALIDATE',
} as const;

export const SYSTEM_TASK_LABELS: Record<string, string> = {
  CONNECT: 'Connect account',
  TEST_LOGIN: 'Test login',
  VALIDATE: 'Validate selectors',
};

export const SCHEDULE_FREQUENCIES = ['once', 'daily', 'weekly', 'specific_days', 'hourly'] as const;
export const MISSED_POLICIES = ['skip', 'run'] as const;

export const NOTIFICATION_TYPES = ['SUCCESS', 'WARNING', 'ERROR', 'INFO', 'ACTION_REQUIRED'] as const;

/**
 * Generic error codes. Platform adapters raise platform-specific codes (e.g. NAUKRI_RESUME_NOT_FOUND)
 * that always map onto one of these categories, so the core can decide retries, account status and
 * notifications without knowing the platform.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'OTP_REQUIRED',
  'CAPTCHA_REQUIRED',
  'SESSION_EXPIRED',
  'ELEMENT_NOT_FOUND',
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  'PLATFORM_BLOCKED',
  'PROFILE_LOCKED',
  'CONFIG_INVALID',
  'PLATFORM_UNAVAILABLE',
  'CANCELLED',
  'UNKNOWN',
] as const;

/** Queue priorities: higher runs first; equal priorities run in FIFO order. */
export const QUEUE_PRIORITY = {
  manual: 100,
  retry: 100,
  missed: 50,
  schedule: 50,
} as const;

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
