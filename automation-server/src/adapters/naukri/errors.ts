import { PLATFORM_IDS } from '@shared/constants/index.js';
import type { ErrorCode } from '@shared/types/index.js';
import { platformError } from '../../errors/automationError.js';

/**
 * Naukri-specific error codes. Each extends the generic model: code NAUKRI_<NAME>, a generic
 * category the core understands, and an explicit retry decision.
 */
const NAUKRI_ERRORS = {
  HEADLESS_BLOCKED: { category: 'TASK_FAILED', retryable: false },
  HEADLINE_EMPTY: { category: 'TASK_FAILED', retryable: false },
  HEADLINE_TOO_LONG: { category: 'TASK_FAILED', retryable: false },
  HEADLINE_REJECTED: { category: 'TASK_FAILED', retryable: false },
  SAVE_FAILED: { category: 'TASK_FAILED', retryable: true },
  PROFILE_NOT_VERIFIED: { category: 'TASK_FAILED', retryable: true },
  RESUME_NOT_FOUND: { category: 'TASK_FAILED', retryable: false },
  RESUME_TOO_LARGE: { category: 'TASK_FAILED', retryable: false },
  UPLOAD_FAILED: { category: 'TASK_FAILED', retryable: true },
  UPLOAD_NOT_VERIFIED: { category: 'TASK_FAILED', retryable: true },
  SHARE_FAILED: { category: 'TASK_FAILED', retryable: false },
} as const satisfies Record<string, { category: ErrorCode; retryable: boolean }>;

export type NaukriErrorName = keyof typeof NAUKRI_ERRORS;

export function naukriError(name: NaukriErrorName, message: string, opts: { retryable?: boolean } = {}) {
  const def = NAUKRI_ERRORS[name];
  return platformError(PLATFORM_IDS.NAUKRI, name, def.category, message, { retryable: opts.retryable ?? def.retryable });
}
