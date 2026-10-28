import { useEffect } from 'react';
import { useRoute } from './router';
import { AppStateProvider, useApp } from './state';
import { FeedbackProvider } from './feedback';
import { Sidebar } from '../components/layout/Sidebar';
import { DashboardPage } from '../pages/Dashboard';
import { PlatformsPage } from '../pages/Platforms';
import { PlatformPage } from '../pages/PlatformPage';
import { AccountsPage, SchedulesPage, TasksPage } from '../pages/Lists';
import { HistoryPage } from '../pages/History';
import { NotificationsPage } from '../pages/Notifications';
import { SettingsPage } from '../pages/Settings';
import { CheckingScreen, OfflineScreen, PairScreen, WelcomeScreen } from '../pages/Connect';

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  platforms: 'Platforms',
  platform: 'Platform',
  accounts: 'Accounts',
  tasks: 'Tasks',
  schedules: 'Schedules',
  history: 'Execution History',
  notifications: 'Notifications',
  settings: 'Settings',
};

function Shell() {
  const route = useRoute();
  const { connection, settings, platformById } = useApp();

  useEffect(() => {
    const name = route.name === 'platform' ? (platformById(route.id)?.name ?? 'Platform') : TITLES[route.name];
    document.title = `${name} · TaskPilot`;
  }, [route, platformById]);

  if (connection === 'checking') return <CheckingScreen />;
  if (connection === 'offline') return <OfflineScreen />;
  if (connection === 'unpaired') return <PairScreen />;
  if (settings && !settings.setupComplete) return <WelcomeScreen />;

  let page: React.ReactNode;
  switch (route.name) {
    case 'platforms':
      page = <PlatformsPage />;
      break;
    case 'platform':
      page = <PlatformPage key={route.id} id={route.id} tab={route.tab} />;
      break;
    case 'accounts':
      page = <AccountsPage />;
      break;
    case 'tasks':
      page = <TasksPage />;
      break;
    case 'schedules':
      page = <SchedulesPage />;
      break;
    case 'history':
      page = <HistoryPage runId={route.runId} />;
      break;
    case 'notifications':
      page = <NotificationsPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <DashboardPage />;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar route={route} />
      <main className="min-w-0 flex-1 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.08),transparent_45%)]">
        <div className="mx-auto max-w-[1440px] px-8 py-8">{page}</div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <FeedbackProvider>
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </FeedbackProvider>
  );
}
