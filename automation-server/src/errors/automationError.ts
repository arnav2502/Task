import type { AccountStatus, ErrorCode, NotificationType, RunStatus } from '@shared/types/index.js';

/**
 * Generic error model for every automation.
 *
 * `category` is always one of the generic ERROR_CODES; the core decides retries, run status,
 * account status and notifications from it. `code` is either the same generic code or a
 * platform-specific one (e.g. NAUKRI_RESUME_NOT_FOUND) created with `platformError()`.
 */
export class AutomationError extends Error {
  readonly code: string;
  readonly category: ErrorCode;
  readonly retryable: boolean;

  constructor(category: ErrorCode, message: string, opts: { code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'AutomationError';
    this.category = category;
    this.code = opts.code ?? category;
    this.retryable = opts.retryable ?? CATEGORY_RULES[category].retryable;
  }
}

interface CategoryRule {
  retryable: boolean;
  runStatus: RunStatus;
  /** Account status to apply after a run fails with this category (null = leave unchanged). */
  accountStatus: AccountStatus | null;
  notification: NotificationType | null;
}

export const CATEGORY_RULES: Record<ErrorCode, CategoryRule> = {
  AUTH_REQUIRED: { retryable: false, runStatus: 'failed', accountStatus: 'auth_required', notification: 'ERROR' },
  INVALID_CREDENTIALS: { retryable: false, runStatus: 'failed', accountStatus: 'login_failed', notification: 'ERROR' },
  OTP_REQUIRED: { retryable: false, runStatus: 'action_required', accountStatus: 'action_required', notification: 'ACTION_REQUIRED' },
  CAPTCHA_REQUIRED: { retryable: false, runStatus: 'action_required', accountStatus: 'action_required', notification: 'ACTION_REQUIRED' },
  SESSION_EXPIRED: { retryable: true, runStatus: 'failed', accountStatus: 'disconnected', notification: 'ERROR' },
  ELEMENT_NOT_FOUND: { retryable: true, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  TIMEOUT: { retryable: true, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  NETWORK_ERROR: { retryable: true, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  TASK_FAILED: { retryable: true, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  PLATFORM_BLOCKED: { retryable: false, runStatus: 'failed', accountStatus: 'blocked', notification: 'ERROR' },
  PROFILE_LOCKED: { retryable: false, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  CONFIG_INVALID: { retryable: false, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  PLATFORM_UNAVAILABLE: { retryable: false, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
  CANCELLED: { retryable: false, runStatus: 'cancelled', accountStatus: null, notification: null },
  UNKNOWN: { retryable: true, runStatus: 'failed', accountStatus: null, notification: 'ERROR' },
};

/**
 * Platform-specific error that extends the generic model:
 *   platformError('naukri', 'RESUME_NOT_FOUND', 'TASK_FAILED', 'No PDF in folder', { retryable: false })
 *   → code NAUKRI_RESUME_NOT_FOUND, category TASK_FAILED
 */
export function platformError(
  platformId: string,
  code: string,
  category: ErrorCode,
  message: string,
  opts: { retryable?: boolean; cause?: unknown } = {},
): AutomationError {
  return new AutomationError(category, message, { ...opts, code: `${platformId.toUpperCase().replace(/-/g, '_')}_${code}` });
}

const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 400);

/** Normalise anything thrown during a run into an AutomationError with a useful message. */
export function toAutomationError(err: unknown): AutomationError {
  if (err instanceof AutomationError) return err;
  const e = err as Error | undefined;
  const msg = e?.message ?? String(err);
  if (e?.name === 'TimeoutError' || /timeout \d+ms exceeded/i.test(msg)) {
    return new AutomationError('TIMEOUT', `Timed out: ${firstLine(msg)}`, { cause: err });
  }
  if (/user data directory is already in use|ProcessSingleton|SingletonLock/i.test(msg)) {
    return new AutomationError('PROFILE_LOCKED', 'This account’s browser profile is already open in another window. Close it and retry.', { cause: err });
  }
  if (/net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return new AutomationError('NETWORK_ERROR', `Network error: ${firstLine(msg)}`, { cause: err });
  }
  if (/Target page, context or browser has been closed|browser has disconnected/i.test(msg)) {
    // A real cancel is recognised by the executor from its abort signal; this is a crash or a closed window.
    return new AutomationError('TASK_FAILED', 'The browser closed unexpectedly before the task finished', { retryable: true, cause: err });
  }
  return new AutomationError('UNKNOWN', firstLine(msg), { cause: err });
}

/** HTTP-facing errors thrown by services and mapped by the API error handler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const conflict = (message: string, code?: string) => new HttpError(409, message, code);
export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
