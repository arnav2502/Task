import type { PlatformExtension } from '../registry';
import { HistoryPage } from '../../History';
import { DraftsTab } from './DraftsTab';
import { LeadsTab } from './LeadsTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { TasksTab } from './TasksTab';
import { PLATFORM, tabHref } from './common';
import { LeadFinderTab } from './wizard/LeadFinderWizard';

function HistoryTab() {
  return <HistoryPage fixedPlatformId={PLATFORM} />;
}

/**
 * LinkedIn module UI: Lead Finder + user-confirmed connection assistant.
 * Its own "tasks" tab replaces the generic one (lead searches with LinkedIn numbers).
 */
export const linkedinExtension: PlatformExtension = {
  tabs: [
    { id: 'overview', label: 'Overview', icon: 'dashboard', component: OverviewTab },
    { id: 'finder', label: 'Lead Finder', icon: 'search', component: LeadFinderTab },
    { id: 'tasks', label: 'Tasks', icon: 'tasks', component: TasksTab },
    { id: 'leads', label: 'Leads', icon: 'accounts', component: LeadsTab },
    { id: 'drafts', label: 'Connection Drafts', icon: 'send', component: DraftsTab },
    { id: 'history', label: 'History', icon: 'history', component: HistoryTab },
    { id: 'settings', label: 'Settings', icon: 'settings', component: SettingsTab },
  ],
  tabOrder: ['overview', 'finder', 'tasks', 'leads', 'drafts', 'history', 'accounts', 'schedules', 'settings'],
  reviewTab: 'drafts',
  editTask: (task) => (location.hash = tabHref('finder', { edit: task.id })),
};
