import { PLATFORM_IDS } from '@shared/constants/index.js';
import type { ErrorCode } from '@shared/types/index.js';
import { platformError } from '../../errors/automationError.js';

/** LinkedIn error codes on top of the generic model (code LINKEDIN_<NAME>). */
const LINKEDIN_ERRORS = {
  SEARCH_UNAVAILABLE: { category: 'TASK_FAILED', retryable: true },
  UNEXPECTED_PAGE: { category: 'TASK_FAILED', retryable: true },
  LEAD_NOT_FOUND: { category: 'CONFIG_INVALID', retryable: false },
  CONNECT_UNAVAILABLE: { category: 'TASK_FAILED', retryable: false },
  EMAIL_REQUIRED: { category: 'TASK_FAILED', retryable: false },
  INVITE_LIMIT: { category: 'TASK_FAILED', retryable: false },
  NOTE_NOT_ALLOWED: { category: 'TASK_FAILED', retryable: false },
  CONNECTION_NOT_CONFIRMED: { category: 'TASK_FAILED', retryable: false },
} as const satisfies Record<string, { category: ErrorCode; retryable: boolean }>;

export type LinkedInErrorName = keyof typeof LINKEDIN_ERRORS;

export function linkedinError(name: LinkedInErrorName, message: string) {
  const def = LINKEDIN_ERRORS[name];
  return platformError(PLATFORM_IDS.LINKEDIN, name, def.category, message, { retryable: def.retryable });
}
