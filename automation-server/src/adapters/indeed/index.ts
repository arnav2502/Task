import { PLATFORM_IDS } from '@shared/constants/index.js';
import { ComingSoonAdapter } from '../base/comingSoonAdapter.js';

/** Indeed — registered so it appears in the UI; automation is not implemented yet. */
export const createIndeedAdapter = () =>
  new ComingSoonAdapter({
    id: PLATFORM_IDS.INDEED,
    name: 'Indeed',
    tagline: 'Job search and applications',
    description: 'Search Indeed for matching roles, apply and keep track of your applications.',
    accent: '#2557A7',
    monogram: 'In',
    website: 'https://www.indeed.com',
    plannedTasks: ['Search jobs', 'Apply to jobs', 'Track applications'],
  });
