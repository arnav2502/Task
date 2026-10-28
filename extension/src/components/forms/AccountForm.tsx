import { useMemo, useState } from 'react';
import type { Account, BrowserMode } from '@shared/types/index';
import { Button, Callout, Field, Input, Modal, Select, Toggle } from '../ui';
import { PlatformMark } from '../status';
import { api } from '../../services/api';
import { useApp } from '../../app/state';
import { useFeedback } from '../../app/feedback';

const MODE_LABEL: Record<BrowserMode, string> = {
  background: 'Background (hidden window)',
  headed: 'Headed (visible window)',
  headless: 'Headless',
};

/** Add or edit an account. Passwords are sent once to the local service and never shown again. */
export function AccountFormModal({ account, defaultPlatformId, onClose, onSaved }: { account?: Account; defaultPlatformId?: string; onClose: () => void; onSaved?: (a: Account) => void }) {
  const { platforms } = useApp();
  const { toast } = useFeedback();
  const editing = !!account;
  const firstActive = platforms.find((p) => p.status === 'active')?.id ?? '';
  const [platformId, setPlatformId] = useState(account?.platformId ?? defaultPlatformId ?? firstActive);
  const [name, setName] = useState(account?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<BrowserMode | ''>(account?.modeOverride ?? '');
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = useMemo(() => platforms.find((p) => p.id === platformId), [platforms, platformId]);
  const needsPassword = platform?.capabilities.requiresLogin ?? true;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!platform || platform.status !== 'active') return setError('Choose an available platform.');
    if (!name.trim()) return setError('Account name is required.');
    if (!editing && username.trim().length < 3) return setError(`${platform.account.usernameLabel} is required.`);
    if (!editing && needsPassword && !password) return setError(`${platform.account.passwordLabel} is required.`);
    setBusy(true);
    try {
      let saved: Account;
      if (editing) {
        saved = await api.updateAccount(account.id, {
          name: name.trim(),
          ...(username.trim() ? { username: username.trim() } : {}),
          ...(password ? { password } : {}),
          modeOverride: mode || null,
          enabled,
        });
        toast('success', `${saved.name} updated`);
      } else {
        saved = await api.createAccount({
          platformId,
          name: name.trim(),
          username: username.trim(),
          ...(needsPassword ? { password } : {}),
          modeOverride: mode || null,
          enabled,
        });
        toast('success', `${saved.name} added — click Connect to sign in once`);
      }
      setPassword('');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${account.name}` : 'Add account'}
      subtitle={editing ? 'Leave username and password empty to keep the stored ones.' : 'Credentials are stored in your OS credential manager by the local service.'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="account-form" loading={busy}>
            {editing ? 'Save changes' : 'Add account'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="space-y-4" autoComplete="off">
        <Field label="Platform" htmlFor="acc-platform">
          {editing ? (
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <PlatformMark platform={platform} size="sm" /> {platform?.name}
            </div>
          ) : (
            <Select id="acc-platform" value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
              {platforms.map((p) => (
                <option key={p.id} value={p.id} disabled={p.status !== 'active'}>
                  {p.name}
                  {p.status !== 'active' ? ' — Coming soon' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Account name" hint="Just for you, e.g. “Personal Naukri”." htmlFor="acc-name">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Personal ${platform?.name ?? ''}`.trim()} maxLength={80} />
        </Field>
        <Field label={platform?.account.usernameLabel ?? 'Username'} hint={editing ? `Current: ${account.username}` : undefined} htmlFor="acc-user">
          <Input
            id="acc-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={editing ? 'Unchanged' : platform?.account.usernamePlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {!needsPassword && platform && (
          <Callout tone="indigo" icon="shield">
            You’ll sign in to {platform.name} yourself in a browser window (<strong>Connect</strong>). TaskPilot never stores your {platform.name} password.
          </Callout>
        )}
        {needsPassword && (
          <Field label={platform?.account.passwordLabel ?? 'Password'} hint={editing ? 'Leave empty to keep the stored password.' : 'Sent once to the local service; never shown again.'} htmlFor="acc-pass">
            <div className="flex gap-2">
              <Input
                id="acc-pass"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editing ? 'Unchanged' : ''}
                autoComplete="new-password"
              />
              <Button icon="eye" variant="ghost" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} />
            </div>
          </Field>
        )}
        <Field label="Browser mode" hint="Background runs a real browser with its window hidden — recommended." htmlFor="acc-mode">
          <Select id="acc-mode" value={mode} onChange={(e) => setMode(e.target.value as BrowserMode | '')}>
            <option value="">Use global default</option>
            {(platform?.capabilities.browserModes ?? ['background', 'headed', 'headless']).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
          <div>
            <div className="text-sm text-slate-200">Scheduled automation</div>
            <div className="text-xs text-slate-500">When off, schedules skip this account. Manual runs still work.</div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Scheduled automation" />
        </div>
        {platform?.notes.length ? (
          <Callout tone="indigo" icon="info">
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {platform.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export { MODE_LABEL };
