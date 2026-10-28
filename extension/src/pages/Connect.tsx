/** Full-screen states shown before the dashboard is usable: pairing, offline, first-run welcome. */
import { useState } from 'react';
import { useApp } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { api } from '../services/api';
import { Button, Callout, Input, Spinner } from '../components/ui';
import { Icon, Logo } from '../components/icons';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_55%)] p-6">
      <div className="w-full max-w-lg animate-pop-in rounded-2xl border border-white/10 bg-ink-800/90 p-8 shadow-2xl backdrop-blur">{children}</div>
    </div>
  );
}

function CommandBox({ command }: { command: string }) {
  const { toast } = useFeedback();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-950 px-4 py-3 font-mono text-sm text-emerald-300">
      <span>
        <span className="select-none text-slate-600">$ </span>
        {command}
      </span>
      <button
        type="button"
        aria-label="Copy command"
        className="text-slate-400 hover:text-white"
        onClick={() => void navigator.clipboard.writeText(command).then(() => toast('info', 'Command copied'))}
      >
        <Icon name="copy" size={16} />
      </button>
    </div>
  );
}

export function CheckingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 text-slate-400">
      <Spinner /> Connecting to TaskPilot service…
    </div>
  );
}

export function OfflineScreen() {
  const { recheck, serviceUrl, setServiceUrl } = useApp();
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState(serviceUrl);
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
          <Icon name="wifiOff" size={22} />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-white">Automation service is offline</h1>
          <p className="text-sm text-slate-400">TaskPilot runs automations in a local service on this computer.</p>
        </div>
      </div>
      <p className="mb-2 text-sm text-slate-300">Start it from the TaskPilot project folder:</p>
      <CommandBox command="npm start" />
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Spinner size={12} /> Retrying automatically every few seconds…
      </p>
      <details className="mt-5 text-sm text-slate-400">
        <summary className="cursor-pointer text-slate-300">Service runs on a different address?</summary>
        <div className="mt-3 flex gap-2">
          <Input aria-label="Service URL" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" />
          <Button onClick={() => void setServiceUrl(url)}>Apply</Button>
        </div>
      </details>
      <div className="mt-6 flex justify-end">
        <Button
          variant="primary"
          icon="refresh"
          loading={checking}
          onClick={async () => {
            setChecking(true);
            await recheck();
            setChecking(false);
          }}
        >
          Retry now
        </Button>
      </div>
    </Shell>
  );
}

export function PairScreen() {
  const { pair, health } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="text-lg font-semibold text-white">Connect to the TaskPilot service</h1>
          <p className="text-sm text-slate-400">The service is running{health ? ` (v${health.version})` : ''}. Pair this extension to control it.</p>
        </div>
      </div>
      <ul className="mb-5 space-y-2 text-sm text-slate-300">
        {[
          'The service only listens on 127.0.0.1 — nothing is reachable from the network.',
          'Pairing gives this extension a private access token. Other extensions and websites are refused.',
          'Passwords stay in your OS credential store; the extension never sees them.',
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-emerald-400" />
            {t}
          </li>
        ))}
      </ul>
      {health?.paired && (
        <div className="mb-4">
          <Callout title="Already paired with another extension">
            If pairing fails, run <code className="rounded bg-black/30 px-1">npm run pair:reset</code> in the project folder and try again.
          </Callout>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-rose-300">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        className="w-full"
        icon="link"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await pair();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Pair extension
      </Button>
    </Shell>
  );
}

/** First-run welcome, shown once until setupComplete is saved. */
export function WelcomeScreen() {
  const { settings, setSettings, platforms } = useApp();
  const { fail } = useFeedback();
  const [name, setName] = useState(settings?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const finish = async (goTo: 'accounts' | 'dashboard') => {
    setBusy(true);
    try {
      setSettings(await api.saveSettings({ displayName: name.trim(), setupComplete: true }));
      navigate({ name: goTo });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const active = platforms.filter((p) => p.status === 'active');
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="text-lg font-semibold text-white">Welcome to TaskPilot</h1>
          <p className="text-sm text-slate-400">Your personal automation control center.</p>
        </div>
      </div>
      <label htmlFor="welcome-name" className="mb-1.5 block text-xs font-medium text-slate-300">
        What should we call you?
      </label>
      <Input id="welcome-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={60} />
      <div className="mt-6 space-y-2 text-sm text-slate-300">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Next steps</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Add an account ({active.map((p) => p.name).join(', ') || 'no platform available yet'}).</li>
          <li>Click Connect once to sign in — the session is kept in an isolated browser profile.</li>
          <li>Configure tasks and create schedules.</li>
        </ol>
      </div>
      <div className="mt-7 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void finish('dashboard')} disabled={busy}>
          Skip
        </Button>
        <Button variant="primary" icon="arrowRight" onClick={() => void finish('accounts')} loading={busy}>
          Add first account
        </Button>
      </div>
    </Shell>
  );
}
