import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '@shared/types/index';
import { DEFAULT_SERVICE_URL } from '@shared/constants/index';
import { api } from '../services/api';
import { useApp } from '../app/state';
import { useFeedback } from '../app/feedback';
import { Badge, Button, Card, CardHeader, Input, PageHeader, Select, Skeleton, Toggle } from '../components/ui';
import type { IconName } from '../components/icons';
import { ThemeToggle } from '../components/ThemeToggle';

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-[220px] flex-1">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Section({ title, icon, subtitle, children }: { title: string; icon: IconName; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </Card>
  );
}

const RETENTION = [
  { value: 24, label: '24 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
  { value: 0, label: 'Never delete' },
];

export function SettingsPage() {
  const { settings, setSettings, health, serviceUrl, setServiceUrl, repair, recheck } = useApp();
  const { toast, fail, confirm } = useFeedback();
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState(serviceUrl);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);
  useEffect(() => setUrl(serviceUrl), [serviceUrl]);

  if (!draft || !settings) return <Skeleton className="h-96" />;

  const patch = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });
  const changed = (Object.keys(draft) as Array<keyof Settings>).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k]));
  const num = (k: keyof Settings, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) patch(k, Math.min(max, Math.max(min, Math.round(n))) as never);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<Settings>;
      const saved = await api.saveSettings(body);
      setSettings(saved);
      setDraft(saved);
      toast('success', 'Settings saved');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle="Applies to every platform. Stored by the local service."
        actions={
          <>
            {changed.length > 0 && (
              <Button variant="ghost" onClick={() => setDraft(settings)}>
                Discard
              </Button>
            )}
            <Button variant="primary" icon="check" onClick={() => void save()} loading={saving} disabled={!changed.length}>
              Save{changed.length ? ` (${changed.length})` : ''}
            </Button>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Section title="General" icon="settings">
            <Row label="Your name" hint="Used in the dashboard greeting.">
              <Input aria-label="Your name" value={draft.displayName} maxLength={60} onChange={(e) => patch('displayName', e.target.value)} className="w-56" />
            </Row>
            <Row label="Theme" hint="Applies instantly to this browser. System follows your OS setting.">
              <div className="w-64">
                <ThemeToggle />
              </div>
            </Row>
          </Section>

          <Section title="Automation" icon="zap" subtitle="How the queue and browser runs behave.">
            <Row label="Default browser mode" hint="Background = a real browser with its window hidden. Some sites (e.g. Naukri) block headless.">
              <Select aria-label="Default browser mode" value={draft.defaultMode} onChange={(e) => patch('defaultMode', e.target.value as Settings['defaultMode'])} className="w-44">
                <option value="background">Background</option>
                <option value="headed">Headed</option>
                <option value="headless">Headless</option>
              </Select>
            </Row>
            <Row label="Max concurrent accounts" hint="Each account runs one job at a time; extra jobs wait in the queue.">
              <Select aria-label="Max concurrent accounts" value={draft.maxConcurrent} onChange={(e) => patch('maxConcurrent', Number(e.target.value))} className="w-24">
                {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Missed schedules" hint="When the computer was off or asleep at a scheduled time.">
              <Select aria-label="Missed schedules" value={draft.missedPolicy} onChange={(e) => patch('missedPolicy', e.target.value as Settings['missedPolicy'])} className="w-56">
                <option value="run">Run 2–6 min after start</option>
                <option value="skip">Skip (record in history)</option>
              </Select>
            </Row>
            <Row label="Retry temporary failures" hint="Timeouts, network errors, missing elements. Never retried: wrong password, OTP/CAPTCHA, cancellations.">
              <Toggle checked={draft.retryEnabled} onChange={(v) => patch('retryEnabled', v)} label="Retry temporary failures" />
            </Row>
            {draft.retryEnabled && (
              <>
                <Row label="Max retries">
                  <Input aria-label="Max retries" type="number" min={0} max={5} value={draft.maxRetries} onChange={num('maxRetries', 0, 5)} className="w-24" />
                </Row>
                <Row label="Retry delay" hint="Seconds between attempts.">
                  <Input aria-label="Retry delay seconds" type="number" min={0} max={600} value={draft.retryDelaySec} onChange={num('retryDelaySec', 0, 600)} className="w-24" />
                </Row>
              </>
            )}
            <Row label="Task timeout" hint="Seconds before a run is stopped (some tasks add time for their own pauses).">
              <Input aria-label="Task timeout seconds" type="number" min={30} max={3600} value={draft.taskTimeoutSec} onChange={num('taskTimeoutSec', 30, 3600)} className="w-24" />
            </Row>
            <Row label="Manual verification wait" hint="How long a visible run waits for you to finish an OTP / CAPTCHA.">
              <Input aria-label="Verification wait seconds" type="number" min={30} max={3600} value={draft.verificationWaitSec} onChange={num('verificationWaitSec', 30, 3600)} className="w-24" />
            </Row>
            <Row label="Run schedules only while Chrome is open" hint="Uses the extension heartbeat (every 30 s).">
              <Toggle checked={draft.requireChromeOpen} onChange={(v) => patch('requireChromeOpen', v)} label="Run only while Chrome is open" />
            </Row>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Notifications" icon="bell">
            <Row label="Failures" hint="Login failed, task failed, resume not found …">
              <Toggle checked={draft.notifyFailures} onChange={(v) => patch('notifyFailures', v)} label="Failure notifications" />
            </Row>
            <Row label="Action required" hint="OTP or CAPTCHA needs you.">
              <Toggle checked={draft.notifyActionRequired} onChange={(v) => patch('notifyActionRequired', v)} label="Action-required notifications" />
            </Row>
            <Row label="Successes" hint="Off by default — scheduled runs stay quiet.">
              <Toggle checked={draft.notifySuccess} onChange={(v) => patch('notifySuccess', v)} label="Success notifications" />
            </Row>
          </Section>

          <Section title="Screenshots & data" icon="image">
            <Row label="Screenshot on failure">
              <Toggle checked={draft.screenshotOnFailure} onChange={(v) => patch('screenshotOnFailure', v)} label="Screenshot on failure" />
            </Row>
            <Row label="Screenshot on success">
              <Toggle checked={draft.screenshotOnSuccess} onChange={(v) => patch('screenshotOnSuccess', v)} label="Screenshot on success" />
            </Row>
            <Row label="Delete logs older than" hint="Run logs, screenshots and finished runs. Platform history that prevents duplicates (e.g. shared roles) is kept.">
              <Select aria-label="Log retention" value={draft.logRetentionHours} onChange={(e) => patch('logRetentionHours', Number(e.target.value))} className="w-40">
                {RETENTION.some((r) => r.value === draft.logRetentionHours) ? null : <option value={draft.logRetentionHours}>{draft.logRetentionHours} hours</option>}
                {RETENTION.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Section>

          <Section title="Service connection" icon="power" subtitle="The extension only controls the local service; automation never runs in Chrome.">
            <Row label="Service URL" hint={`Default ${DEFAULT_SERVICE_URL}`}>
              <Input aria-label="Service URL" value={url} onChange={(e) => setUrl(e.target.value)} className="w-56 font-mono text-xs" />
              <Button
                size="sm"
                disabled={url.trim() === serviceUrl}
                onClick={async () => {
                  try {
                    await setServiceUrl(url.trim() || DEFAULT_SERVICE_URL);
                    toast('success', 'Service URL updated');
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Apply
              </Button>
            </Row>
            <Row label="Status">
              {health ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge tone="green" dot>
                    Online · v{health.version}
                  </Badge>
                  <Badge tone={health.paired ? 'indigo' : 'amber'}>{health.paired ? 'Paired' : 'Not paired'}</Badge>
                  <Badge tone="slate">{health.credentialBackend === 'keyring' ? 'OS credential store' : 'Encrypted vault'}</Badge>
                  <Badge tone="slate">{health.platforms} platforms</Badge>
                </div>
              ) : (
                <Badge tone="red" dot>
                  Offline
                </Badge>
              )}
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void recheck()}>
                Check
              </Button>
            </Row>
            <Row label="Pairing" hint="Get a new access token from the service (e.g. after the service data was reset).">
              <Button
                size="sm"
                icon="link"
                onClick={async () => {
                  if (!(await confirm({ title: 'Re-pair with the service?', message: 'The extension requests a fresh token. If the service is paired with a different extension, run “npm run pair:reset” in the project folder first.', confirmLabel: 'Re-pair' })))
                    return;
                  try {
                    await repair();
                    toast('success', 'Paired with the TaskPilot service');
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Re-pair
              </Button>
            </Row>
            <Row label="Setup">
              <Button size="sm" variant="ghost" onClick={() => void api.saveSettings({ setupComplete: false }).then(setSettings).catch(fail)}>
                Show welcome again
              </Button>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
