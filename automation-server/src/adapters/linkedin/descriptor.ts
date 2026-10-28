import { z } from 'zod';
import { PLATFORM_IDS } from '@shared/constants/index.js';
import type { PlatformDescriptor } from '@shared/types/index.js';
import { LINKEDIN_NOTE_MAX, LINKEDIN_TASKS } from '@shared/types/linkedin.js';

const tags = z.array(z.string().trim().min(1).max(80)).max(30).default([]);

/** Configuration of one Lead Finder task. Every field has a default; cross-field rules are refined below. */
export const LEAD_FINDER_SCHEMA = z
  .object({
    keywords: z.string().trim().max(200).default(''),
    jobTitles: tags,
    locations: tags,
    companies: tags,
    currentCompany: z.string().trim().max(120).default(''),
    industry: z.string().trim().max(120).default(''),
    schools: tags,
    profileKeywords: tags,
    connectionDegree: z.enum(['all', '1st', '2nd', '3rd']).default('2nd'),
    action: z.enum(['find_only', 'prepare_connection', 'prepare_with_note']).default('prepare_connection'),
    noteMode: z.enum(['none', 'same', 'personalized']).default('none'),
    note: z.string().max(LINKEDIN_NOTE_MAX, `A LinkedIn note can be at most ${LINKEDIN_NOTE_MAX} characters`).default(''),
    maxLeads: z.number().int().min(1).max(50).default(20),
    maxCandidates: z.number().int().min(1).max(25).default(10),
  })
  .refine((c) => c.keywords.length > 0 || c.jobTitles.length > 0, { message: 'Enter search keywords or at least one job title', path: ['keywords'] })
  .refine((c) => c.action !== 'prepare_with_note' || c.noteMode !== 'none', {
    message: 'Choose "Same note" or "Personalized draft" when preparing a connection note',
    path: ['noteMode'],
  })
  .refine((c) => c.noteMode === 'none' || c.note.trim().length > 0, { message: 'Write the connection note (or choose "No note")', path: ['note'] });

export type LeadFinderConfigParsed = z.infer<typeof LEAD_FINDER_SCHEMA>;

const DEFAULTS = {
  ...LEAD_FINDER_SCHEMA.parse({ keywords: 'Technical Recruiter' }),
  keywords: '',
  note: 'Hi {firstName}, I came across your profile and would be glad to connect and learn more about opportunities at {company}.',
};

export const LINKEDIN_DESCRIPTOR: PlatformDescriptor = {
  id: PLATFORM_IDS.LINKEDIN,
  name: 'LinkedIn',
  tagline: 'Lead Finder + connection assistant (you confirm every request)',
  description:
    'Search LinkedIn for recruiters, hiring managers and founders, keep a de-duplicated lead list, and prepare connection requests with an optional note. Nothing is sent until you confirm it.',
  status: 'active',
  accent: '#0A66C2',
  monogram: 'in',
  website: 'https://www.linkedin.com',
  capabilities: {
    // No LinkedIn password is stored: you sign in yourself in a visible window (Connect).
    requiresLogin: false,
    browserModes: ['background', 'headed', 'headless'],
    defaultMode: 'background',
    supportsConnect: true,
    supportsValidation: false,
  },
  account: { usernameLabel: 'LinkedIn email (for your reference)', usernamePlaceholder: 'you@example.com', passwordLabel: 'Password' },
  tasks: [
    {
      type: LINKEDIN_TASKS.LEAD_FINDER,
      name: 'Lead Finder',
      description:
        'Searches LinkedIn people results with your filters (a few results per run), adds new leads without duplicates, and prepares connection drafts for your review. It never sends a request.',
      effect: 'read',
      // Re-running a search is harmless, but keep runs predictable: one attempt per run.
      retryable: false,
      multiInstance: true,
      configFields: [
        { key: 'keywords', label: 'Search keywords', type: 'text', placeholder: 'Technical Recruiter' },
        { key: 'jobTitles', label: 'Job titles', type: 'tags', placeholder: 'Talent Acquisition, HR Recruiter' },
        { key: 'locations', label: 'Locations', type: 'tags', placeholder: 'India, Bangalore, Remote' },
        { key: 'companies', label: 'Companies', type: 'tags', placeholder: 'TCS, Infosys' },
        { key: 'currentCompany', label: 'Current company', type: 'text' },
        { key: 'industry', label: 'Industry', type: 'text' },
        { key: 'schools', label: 'Schools', type: 'tags' },
        { key: 'profileKeywords', label: 'Profile keywords', type: 'tags', placeholder: 'Java, QA, Automation' },
        {
          key: 'connectionDegree',
          label: 'Connection degree',
          type: 'select',
          options: [
            { value: 'all', label: 'All' },
            { value: '1st', label: '1st degree' },
            { value: '2nd', label: '2nd degree' },
            { value: '3rd', label: '3rd degree' },
          ],
        },
        {
          key: 'action',
          label: 'What to prepare',
          type: 'select',
          options: [
            { value: 'find_only', label: 'Find leads only' },
            { value: 'prepare_connection', label: 'Find leads + prepare connection' },
            { value: 'prepare_with_note', label: 'Find leads + prepare connection note' },
          ],
        },
        {
          key: 'noteMode',
          label: 'Connection note',
          type: 'select',
          options: [
            { value: 'none', label: 'No note' },
            { value: 'same', label: 'Same note for all leads' },
            { value: 'personalized', label: 'Personalized draft per lead' },
          ],
        },
        { key: 'note', label: 'Note / template', type: 'text', maxLength: LINKEDIN_NOTE_MAX, help: 'Placeholders: {firstName} {name} {title} {company}' },
        { key: 'maxLeads', label: 'Results read per run', type: 'number', min: 1, max: 50 },
        { key: 'maxCandidates', label: 'Connection candidates per run', type: 'number', min: 1, max: 25 },
      ],
      defaultConfig: DEFAULTS,
      metricLabel: 'Lead searches',
      notify: { success: 'LinkedIn search completed.', failure: 'LinkedIn search failed.' },
      schedulePresets: [
        { label: 'Weekdays 10:00 AM', frequency: 'specific_days', time: '10:00', daysOfWeek: [1, 2, 3, 4, 5] },
        { label: 'Daily 9:00 AM', frequency: 'daily', time: '09:00' },
        { label: 'Mondays 11:00 AM', frequency: 'weekly', time: '11:00', daysOfWeek: [1] },
      ],
    },
  ],
  plannedTasks: ['Save jobs', 'Search jobs', 'Track applications'],
  notes: [
    'TaskPilot finds and prepares — you confirm every connection request yourself. Nothing is sent in bulk or by a schedule.',
    'LinkedIn restricts automated activity. Runs read only a few results, in your own signed-in browser, with no stealth or limit bypass.',
    'TaskPilot never stores your LinkedIn password: click Connect and sign in yourself.',
    'Free LinkedIn accounts can send only a few personalized notes per month; you can always send without a note.',
  ],
};
