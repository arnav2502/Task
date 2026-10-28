import { PLATFORM_IDS } from '@shared/constants/index.js';
import { ComingSoonAdapter } from '../base/comingSoonAdapter.js';

/**
 * Career Portal Manager — not implemented yet. Design (see docs/ADDING_A_PLATFORM.md):
 *
 * - An "account" is a monitored company portal: name = company (e.g. TCS), username = career-page URL,
 *   no password (capabilities.requiresLogin = false), so it reuses accounts, tasks, schedules, queue,
 *   history and notifications unchanged.
 * - One task type, MONITOR_JOBS, with config { keywords: string[], locations: string[], experience: string }.
 * - executeTask() reads the portal (per-portal selector profile, or a generic job-list extractor), stores
 *   seen postings in its own table `career_portal_jobs (account_id, job_key, title, location, url, first_seen_at)`,
 *   and returns new matches; each new match raises an INFO notification
 *   "New matching career portal job found".
 */
export const createCareerPortalsAdapter = () =>
  new ComingSoonAdapter({
    id: PLATFORM_IDS.CAREER_PORTALS,
    name: 'Career Portals',
    tagline: 'Watch company career pages',
    description: 'Add company career pages (e.g. TCS) with keywords, locations and experience, and get notified when a matching job is posted.',
    accent: '#F59E0B',
    monogram: 'CP',
    website: null,
    requiresLogin: false,
    usernameLabel: 'Career page URL',
    plannedTasks: [
      'Monitor career pages for new jobs',
      'Match job keywords (e.g. QA Engineer, SDET)',
      'Filter by location and experience',
      'Notify on new matching postings',
    ],
  });
