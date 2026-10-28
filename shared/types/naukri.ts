/**
 * Naukri-specific types used by the Naukri module UI and the Naukri adapter's own routes
 * (/platforms/naukri/...). Generic code never imports this file.
 */

export const NAUKRI_TASKS = {
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  RESUME_UPLOAD: 'RESUME_UPLOAD',
  SHARE_INTEREST: 'SHARE_INTEREST',
} as const;

export type NaukriTaskType = (typeof NAUKRI_TASKS)[keyof typeof NAUKRI_TASKS];

/** Naukri accepts resumes up to 2 MB. */
export const NAUKRI_MAX_RESUME_BYTES = 2 * 1024 * 1024;

export interface ProfileUpdateConfig {
  /** Appended to / removed from the end of the Resume headline on every run. */
  marker: string;
}

export interface ResumeUploadConfig {
  folderPath: string;
  selectionMode: 'latest' | 'specific';
  specificFile: string;
}

export interface ShareInterestConfig {
  rolesPerRun: number;
  dailyLimit: number;
  includeKeywords: string[];
  excludeKeywords: string[];
  minDelaySec: number;
  maxDelaySec: number;
}

export interface ResumeFileInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Over Naukri's 2 MB limit. */
  tooLarge: boolean;
}

export interface ResumeFolderScan {
  folderPath: string;
  exists: boolean;
  files: ResumeFileInfo[];
  latest: ResumeFileInfo | null;
  /** The file the next upload will use. */
  selected: ResumeFileInfo | null;
  error: string | null;
}

/** pending = clicked but the outcome is not known yet (e.g. the run was cancelled mid-click); never retried. */
export type SharedJobStatus = 'pending' | 'shared' | 'failed' | 'skipped';

export interface SharedJob {
  id: number;
  accountId: string;
  jobId: string;
  title: string;
  company: string | null;
  experience: string | null;
  salary: string | null;
  location: string | null;
  status: SharedJobStatus;
  message: string | null;
  runId: string | null;
  sharedAt: string;
}

export interface SharedJobsResponse {
  jobs: SharedJob[];
  /** Successful shares today, per account id. */
  sharedToday: Record<string, number>;
}
