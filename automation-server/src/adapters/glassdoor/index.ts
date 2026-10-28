import { PLATFORM_IDS } from '@shared/constants/index.js';
import { ComingSoonAdapter } from '../base/comingSoonAdapter.js';

/** Glassdoor — registered so it appears in the UI; automation is not implemented yet. */
export const createGlassdoorAdapter = () =>
  new ComingSoonAdapter({
    id: PLATFORM_IDS.GLASSDOOR,
    name: 'Glassdoor',
    tagline: 'Jobs and company research',
    description: 'Find jobs, apply and research companies (reviews, salaries, interviews) on Glassdoor.',
    accent: '#0CAA41',
    monogram: 'Gd',
    website: 'https://www.glassdoor.co.in',
    plannedTasks: ['Search jobs', 'Apply to jobs', 'Company research'],
  });
