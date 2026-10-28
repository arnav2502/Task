/** Global (all-platform) Accounts, Tasks and Schedules pages. */
import { useState } from 'react';
import { useApp } from '../app/state';
import { PageHeader, Select } from '../components/ui';
import { AccountsPanel } from '../components/AccountsPanel';
import { TasksPanel } from '../components/TasksPanel';
import { SchedulesPanel } from '../components/SchedulesPanel';

function PlatformFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { platforms } = useApp();
  return (
    <Select aria-label="Filter by platform" value={value} onChange={(e) => onChange(e.target.value)} className="w-48">
      <option value="">All platforms</option>
      {platforms
        .filter((p) => p.status === 'active')
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </Select>
  );
}

export function AccountsPage() {
  const [platformId, setPlatformId] = useState('');
  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Accounts"
        subtitle="Every account belongs to a platform and has its own isolated browser profile. Passwords live in your OS credential store, never in the extension."
        actions={<PlatformFilter value={platformId} onChange={setPlatformId} />}
      />
      <AccountsPanel platformId={platformId || undefined} />
    </div>
  );
}

export function TasksPage() {
  const [platformId, setPlatformId] = useState('');
  return (
    <div>
      <PageHeader
        eyebrow="Automations"
        title="Tasks"
        subtitle="One card per task per account. The toggle controls scheduled runs; Run now always works."
        actions={<PlatformFilter value={platformId} onChange={setPlatformId} />}
      />
      <TasksPanel platformId={platformId || undefined} />
    </div>
  );
}

export function SchedulesPage() {
  const [platformId, setPlatformId] = useState('');
  return (
    <div>
      <PageHeader
        eyebrow="Automations"
        title="Schedules"
        subtitle="One shared scheduler for every platform. Schedules run in the local service, even when Chrome is closed."
        actions={<PlatformFilter value={platformId} onChange={setPlatformId} />}
      />
      <SchedulesPanel platformId={platformId || undefined} />
    </div>
  );
}
