import { z } from 'zod';
import { PLATFORM_IDS } from '@shared/constants/index.js';
import type { PlatformDescriptor } from '@shared/types/index.js';
import { NAUKRI_TASKS } from '@shared/types/naukri.js';

const keywords = z.array(z.string().trim().min(1).max(60)).max(50).default([]);

/** Zod schemas for each task's configuration; every field has a default. */
export const NAUKRI_CONFIG_SCHEMAS = {
  [NAUKRI_TASKS.PROFILE_UPDATE]: z.object({
    marker: z.string().min(1, 'The marker cannot be empty').max(5).default('.'),
  }),
  [NAUKRI_TASKS.RESUME_UPLOAD]: z.object({
    folderPath: z.string().trim().max(1000).default(''),
    selectionMode: z.enum(['latest', 'specific']).default('latest'),
    specificFile: z.string().trim().max(260).default(''),
  }),
  [NAUKRI_TASKS.SHARE_INTEREST]: z
    .object({
      rolesPerRun: z.number().int().min(1).max(50).default(5),
      dailyLimit: z.number().int().min(1).max(200).default(25),
      includeKeywords: keywords,
      excludeKeywords: keywords,
      minDelaySec: z.number().int().min(5).max(600).default(25),
      maxDelaySec: z.number().int().min(5).max(900).default(75),
    })
    .refine((v) => v.maxDelaySec >= v.minDelaySec, { message: 'The maximum delay must be at least the minimum delay', path: ['maxDelaySec'] }),
};

const defaults = <K extends keyof typeof NAUKRI_CONFIG_SCHEMAS>(k: K) => NAUKRI_CONFIG_SCHEMAS[k].parse({}) as Record<string, unknown>;

export const NAUKRI_DESCRIPTOR: PlatformDescriptor = {
  id: PLATFORM_IDS.NAUKRI,
  name: 'Naukri',
  tagline: 'Profile freshness, resume and early-access applications',
  description: 'Keep your Naukri profile fresh every day, upload your latest resume, and share interest in Early access roles automatically.',
  status: 'active',
  accent: '#4A7BF7',
  monogram: 'N',
  website: 'https://www.naukri.com',
  capabilities: {
    requiresLogin: true,
    browserModes: ['background', 'headed', 'headless'],
    defaultMode: 'background',
    supportsConnect: true,
    supportsValidation: true,
  },
  account: { usernameLabel: 'Naukri email / username', usernamePlaceholder: 'you@example.com', passwordLabel: 'Naukri password' },
  tasks: [
    {
      type: NAUKRI_TASKS.PROFILE_UPDATE,
      name: 'Profile Update',
      description:
        'Adds or removes a marker at the end of your Resume headline so Naukri shows your profile as updated today. Verified after a reload; no other field is touched.',
      effect: 'update',
      retryable: true,
      configFields: [
        { key: 'marker', label: 'Update marker', type: 'text', maxLength: 5, help: 'Appended to / removed from the end of the Resume headline on alternate runs.' },
      ],
      defaultConfig: defaults(NAUKRI_TASKS.PROFILE_UPDATE),
      metricLabel: 'Profile updates',
      notify: { success: 'Naukri profile updated successfully.', failure: 'Naukri profile update failed.' },
      schedulePresets: [
        { label: 'Daily 9:00 AM', frequency: 'daily', time: '09:00' },
        { label: 'Hourly 7 AM–11 PM, random minute', frequency: 'hourly', time: '07:00', windowEnd: '23:00', randomMinute: true },
      ],
    },
    {
      type: NAUKRI_TASKS.RESUME_UPLOAD,
      name: 'Resume Upload',
      description: 'Uploads the newest (or a chosen) PDF from your resume folder, then verifies Naukri shows that file with today’s date. PDF only, up to 2 MB.',
      effect: 'update',
      retryable: true,
      configFields: [
        { key: 'folderPath', label: 'Resume folder', type: 'folder', help: 'Scanned right before every upload.' },
        {
          key: 'selectionMode',
          label: 'Which PDF',
          type: 'select',
          options: [
            { value: 'latest', label: 'Latest modified PDF' },
            { value: 'specific', label: 'A specific PDF' },
          ],
        },
        { key: 'specificFile', label: 'Specific PDF file name', type: 'text', placeholder: 'Resume_2026.pdf', help: 'Only used with “A specific PDF”.' },
      ],
      defaultConfig: defaults(NAUKRI_TASKS.RESUME_UPLOAD),
      metricLabel: 'Resume uploads',
      notify: { success: 'Resume uploaded successfully.', failure: 'Resume upload failed.' },
      schedulePresets: [
        { label: 'Daily 9:30 AM', frequency: 'daily', time: '09:30' },
        { label: 'Weekdays 10:00 AM', frequency: 'specific_days', time: '10:00', daysOfWeek: [1, 2, 3, 4, 5] },
      ],
    },
    {
      type: NAUKRI_TASKS.SHARE_INTEREST,
      name: 'Share Interest',
      description:
        'Clicks “Share interest” on Naukri’s Early access roles, one at a time in random order with human-like pauses. On Naukri this submits a job application.',
      effect: 'apply',
      retryable: false,
      configFields: [
        { key: 'rolesPerRun', label: 'Roles per run', type: 'number', min: 1, max: 50 },
        { key: 'dailyLimit', label: 'Daily limit', type: 'number', min: 1, max: 200, help: 'Maximum successful shares per account per day.' },
        { key: 'includeKeywords', label: 'Include keywords', type: 'tags', placeholder: 'QA, Playwright, SDET', help: 'Only roles whose title, company or skills match one of these. Empty = all.' },
        { key: 'excludeKeywords', label: 'Exclude keywords', type: 'tags', placeholder: 'Sales, Senior', help: 'Never share roles matching any of these.' },
        { key: 'minDelaySec', label: 'Minimum pause between roles', type: 'number', min: 5, max: 600, unit: 's' },
        { key: 'maxDelaySec', label: 'Maximum pause between roles', type: 'number', min: 5, max: 900, unit: 's' },
      ],
      defaultConfig: defaults(NAUKRI_TASKS.SHARE_INTEREST),
      notify: { success: 'Naukri interest shared.', failure: 'Naukri Share Interest failed.' },
      schedulePresets: [{ label: 'Hourly 9 AM–9 PM, random minute', frequency: 'hourly', time: '09:00', windowEnd: '21:00', randomMinute: true }],
    },
  ],
  plannedTasks: [],
  notes: [
    'Headless mode is blocked by Naukri (HTTP 403) — Background mode runs a real browser with its window hidden.',
    'Share Interest submits job applications on your behalf. A role is never shared twice.',
    'OTP and CAPTCHA are never bypassed. Background runs stop and ask you to click Connect.',
    'Resumes: PDF only, up to 2 MB.',
  ],
};
