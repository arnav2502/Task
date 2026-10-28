import { PLATFORM_IDS } from '@shared/constants/index.js';
import { ComingSoonAdapter } from '../base/comingSoonAdapter.js';

/**
 * Custom Tasks — not implemented yet. Design: an "account" is a website target (URL, optional login);
 * task types such as OPEN_PAGE, WATCH_ELEMENT (notify when an item appears) and WATCH_TEXT (notify on
 * status change) carry their selector/URL in the task configuration. Everything else is the shared core.
 */
export const createCustomAdapter = () =>
  new ComingSoonAdapter({
    id: PLATFORM_IDS.CUSTOM,
    name: 'Custom Tasks',
    tagline: 'Your own website automations',
    description: 'Point TaskPilot at any website: open it on a schedule, watch for an item to appear, or get notified when a status changes.',
    accent: '#EC4899',
    monogram: 'Cu',
    website: null,
    requiresLogin: false,
    usernameLabel: 'Website URL',
    plannedTasks: ['Open a website on a schedule', 'Check whether a new item appears', 'Notify me when a status changes'],
  });
