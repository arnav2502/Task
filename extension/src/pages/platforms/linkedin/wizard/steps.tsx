/** The Lead Finder wizard steps. Pure presentational: state lives in LeadFinderWizard. */
import type { ReactNode } from 'react';
import type { AccountSummary } from '@shared/types/index';
import type { LeadAction, LeadFinderConfig, NoteMode } from '@shared/types/linkedin';
import { Badge, Button, Callout, Field, Input, Segmented, Select, TagInput } from '../../../../components/ui';
import { Icon, type IconName } from '../../../../components/icons';
import { cx } from '../../../../utils/format';
import { ACTION_LABEL, DEFAULT_TEMPLATE, DEGREE_LABEL, NOTE_MODE_LABEL, NoteEditor } from '../common';

export type Repeat = 'once' | 'daily' | 'weekly' | 'weekdays';
export type RunChoice = 'now' | 'schedule' | 'save';

export interface WizardState {
  name: string;
  accountId: string;
  config: LeadFinderConfig;
  run: { choice: RunChoice; date: string; time: string; repeat: Repeat };
}

export type Patch = (fn: (s: WizardState) => WizardState) => void;
const setConfig = (patch: Patch, c: Partial<LeadFinderConfig>) => patch((s) => ({ ...s, config: { ...s.config, ...c } }));

function Choice({ checked, onClick, title, description, icon }: { checked: boolean; onClick: () => void; title: ReactNode; description?: ReactNode; icon?: IconName }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cx(
        'flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
        checked ? 'bg-indigo-500/10 ring-indigo-400/40' : 'ring-white/10 hover:bg-white/[0.03]',
      )}
    >
      <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-2', checked ? 'ring-indigo-400' : 'ring-slate-500')}>
        {checked && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-white">
          {icon && <Icon name={icon} size={15} className="text-slate-400" />}
          {title}
        </span>
        {description && <span className="mt-0.5 block text-xs text-slate-400">{description}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- 1 basics
export function StepBasics({ s, patch, accounts, onAddAccount }: { s: WizardState; patch: Patch; accounts: AccountSummary[]; onAddAccount: () => void }) {
  return (
    <div className="space-y-5">
      <Field label="Task name" hint="How this search appears in Tasks, History and notifications." htmlFor="lf-name">
        <Input id="lf-name" value={s.name} maxLength={80} placeholder="Find QA Recruiters" onChange={(e) => patch((x) => ({ ...x, name: e.target.value }))} />
      </Field>
      {accounts.length === 0 ? (
        <Callout tone="amber" icon="accounts" title="No LinkedIn account yet">
          <p>Add your LinkedIn account and click Connect to sign in once. The search runs in that signed-in browser.</p>
          <Button className="mt-2" size="sm" variant="primary" icon="plus" onClick={onAddAccount}>
            Add LinkedIn account
          </Button>
        </Callout>
      ) : accounts.length > 1 ? (
        <Field label="LinkedIn account" htmlFor="lf-account">
          <Select id="lf-account" value={s.accountId} onChange={(e) => patch((x) => ({ ...x, accountId: e.target.value }))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.username})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="text-xs text-slate-400">
          Runs with <span className="font-medium text-slate-200">{accounts[0]!.name}</span>.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 2 search
export function StepSearch({ s, patch }: { s: WizardState; patch: Patch }) {
  const c = s.config;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2">
        <Field label="Keywords" hint="What you would type into LinkedIn search, e.g. “Technical Recruiter”." htmlFor="lf-kw">
          <Input id="lf-kw" value={c.keywords} maxLength={200} placeholder="Technical Recruiter" onChange={(e) => setConfig(patch, { keywords: e.target.value })} />
        </Field>
      </div>
      <Field label="Job titles" hint="A lead matches if its headline contains any of these. Press Enter after each." htmlFor="lf-titles">
        <TagInput id="lf-titles" value={c.jobTitles} onChange={(v) => setConfig(patch, { jobTitles: v })} placeholder="Technical Recruiter, Talent Acquisition" />
      </Field>
      <Field label="Locations" hint="Matched against the location on each result (empty = anywhere)." htmlFor="lf-loc">
        <TagInput id="lf-loc" value={c.locations} onChange={(v) => setConfig(patch, { locations: v })} placeholder="India, Delhi, Bangalore, Remote" />
      </Field>
      <div className="md:col-span-2">
        <Field label="Company (optional)" hint="Current or past company — sent to LinkedIn’s company keyword field." htmlFor="lf-company">
          <TagInput id="lf-company" value={c.companies} onChange={(v) => setConfig(patch, { companies: v })} placeholder="TCS, Infosys, Accenture" />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3 filters
type OptionalKey = 'industry' | 'currentCompany' | 'schools' | 'profileKeywords';
export const OPTIONAL_FILTERS: Array<{ key: OptionalKey; label: string; hint: string }> = [
  { key: 'industry', label: 'Industry', hint: 'Added to the search keywords (LinkedIn’s industry filter needs internal ids).' },
  { key: 'currentCompany', label: 'Current company', hint: 'Must appear in the lead’s headline.' },
  { key: 'schools', label: 'School', hint: 'Sent to LinkedIn’s school keyword field.' },
  { key: 'profileKeywords', label: 'Profile keywords', hint: 'Any of these must appear in the headline, e.g. Java, QA, Automation.' },
];

export const filterHasValue = (c: LeadFinderConfig, k: OptionalKey) => (Array.isArray(c[k]) ? (c[k] as string[]).length > 0 : !!String(c[k] ?? '').trim());

export function StepFilters({ s, patch, shown, setShown }: { s: WizardState; patch: Patch; shown: OptionalKey[]; setShown: (v: OptionalKey[]) => void }) {
  const c = s.config;
  const available = OPTIONAL_FILTERS.filter((f) => !shown.includes(f.key));
  const remove = (k: OptionalKey) => {
    setShown(shown.filter((x) => x !== k));
    setConfig(patch, { [k]: Array.isArray(c[k]) ? [] : '' } as Partial<LeadFinderConfig>);
  };
  return (
    <div className="space-y-5">
      <Field label="Connection degree">
        <Segmented
          ariaLabel="Connection degree"
          value={c.connectionDegree}
          onChange={(v) => setConfig(patch, { connectionDegree: v })}
          options={(['all', '1st', '2nd', '3rd'] as const).map((v) => ({ value: v, label: v === 'all' ? 'All' : DEGREE_LABEL[v] }))}
        />
      </Field>

      <div className="space-y-3">
        <div className="text-xs font-medium text-slate-300">Optional filters</div>
        {shown.length === 0 && <p className="text-xs text-slate-500">No optional filters. Add one below.</p>}
        {shown.map((k) => {
          const f = OPTIONAL_FILTERS.find((x) => x.key === k)!;
          const isList = Array.isArray(c[k]);
          return (
            <div key={k} className="flex items-start gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.06]">
              <div className="flex-1">
                <Field label={f.label} hint={f.hint} htmlFor={`lf-${k}`}>
                  {isList ? (
                    <TagInput id={`lf-${k}`} value={c[k] as string[]} onChange={(v) => setConfig(patch, { [k]: v } as Partial<LeadFinderConfig>)} placeholder={`Add ${f.label.toLowerCase()}`} />
                  ) : (
                    <Input id={`lf-${k}`} value={String(c[k] ?? '')} maxLength={120} onChange={(e) => setConfig(patch, { [k]: e.target.value } as Partial<LeadFinderConfig>)} />
                  )}
                </Field>
              </div>
              <Button size="sm" variant="ghost" icon="x" aria-label={`Remove ${f.label} filter`} onClick={() => remove(k)} />
            </div>
          );
        })}
        {available.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {available.map((f) => (
              <Button key={f.key} size="sm" variant="subtle" icon="plus" onClick={() => setShown([...shown, f.key])}>
                {f.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Results to read per run" hint="Kept small on purpose (max 50)." htmlFor="lf-max">
          <Input id="lf-max" type="number" min={1} max={50} value={c.maxLeads} onChange={(e) => setConfig(patch, { maxLeads: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
        </Field>
        <Field label="Connection candidates per run" hint="Prepared for your review (max 25)." htmlFor="lf-cand">
          <Input id="lf-cand" type="number" min={1} max={25} value={c.maxCandidates} onChange={(e) => setConfig(patch, { maxCandidates: Math.max(1, Math.min(25, Number(e.target.value) || 1)) })} />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 4 action
export function StepAction({ s, patch }: { s: WizardState; patch: Patch }) {
  const set = (action: LeadAction) =>
    setConfig(patch, {
      action,
      noteMode: action === 'prepare_with_note' ? (s.config.noteMode === 'none' ? 'same' : s.config.noteMode) : 'none',
    });
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-300">What should TaskPilot prepare?</div>
      <div role="radiogroup" aria-label="Connection action" className="space-y-2">
        <Choice checked={s.config.action === 'find_only'} onClick={() => set('find_only')} icon="search" title={ACTION_LABEL.find_only} description="Discover matching people and add them to your lead list." />
        <Choice
          checked={s.config.action === 'prepare_connection'}
          onClick={() => set('prepare_connection')}
          icon="accounts"
          title={ACTION_LABEL.prepare_connection}
          description="Matching leads are queued in Connection Drafts for your review — without a note."
        />
        <Choice
          checked={s.config.action === 'prepare_with_note'}
          onClick={() => set('prepare_with_note')}
          icon="edit"
          title={ACTION_LABEL.prepare_with_note}
          description="Also prepares a connection note you can edit before sending."
        />
      </div>
      <Callout tone="amber" icon="hand" title="IMPORTANT">
        Actual connection sending requires your confirmation. TaskPilot never sends a request on its own — you press <strong>Confirm &amp; Send</strong> for each lead.
      </Callout>
    </div>
  );
}

// ---------------------------------------------------------------- 5 note
export function StepNote({ s, patch }: { s: WizardState; patch: Patch }) {
  const c = s.config;
  if (c.action === 'find_only') {
    return <Callout tone="indigo" icon="info">This task only finds leads, so no connection note is needed. Choose a connection action in the previous step to prepare notes.</Callout>;
  }
  const setMode = (noteMode: NoteMode) =>
    setConfig(patch, {
      noteMode,
      action: noteMode === 'none' ? 'prepare_connection' : 'prepare_with_note',
      note: noteMode === 'personalized' && !c.note.trim() ? DEFAULT_TEMPLATE : c.note,
    });
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-300">Do you want to add a connection note?</div>
      <div role="radiogroup" aria-label="Connection note" className="space-y-2">
        <Choice checked={c.noteMode === 'none'} onClick={() => setMode('none')} title={NOTE_MODE_LABEL.none} description="Requests are prepared without a note." />
        <Choice checked={c.noteMode === 'same'} onClick={() => setMode('same')} title="Use the same note for all selected leads" />
        <Choice
          checked={c.noteMode === 'personalized'}
          onClick={() => setMode('personalized')}
          title="Generate / edit a note for each lead"
          description="A personalized draft is filled in for every lead from the template below; you review and can edit each one before sending."
        />
      </div>
      {c.noteMode !== 'none' && (
        <Field label={c.noteMode === 'same' ? 'Connection note' : 'Note template'} htmlFor="lf-note">
          <NoteEditor id="lf-note" value={c.note} onChange={(note) => setConfig(patch, { note })} template={c.noteMode === 'personalized'} />
        </Field>
      )}
      <p className="text-xs text-slate-500">LinkedIn allows up to 300 characters, and free accounts get a limited number of personalized invitations per month.</p>
    </div>
  );
}

// ---------------------------------------------------------------- 6 run
const REPEAT_LABEL: Record<Repeat, string> = { once: 'Once', daily: 'Daily', weekly: 'Weekly', weekdays: 'Every weekday (Mon–Fri)' };

export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

export function StepRun({ s, patch, editing }: { s: WizardState; patch: Patch; editing: boolean }) {
  const r = s.run;
  const setRun = (p: Partial<WizardState['run']>) => patch((x) => ({ ...x, run: { ...x.run, ...p } }));
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Run settings" className="space-y-2">
        <Choice checked={r.choice === 'now'} onClick={() => setRun({ choice: 'now' })} icon="play" title="Run now" description="Searches right away; results wait for your review." />
        <Choice checked={r.choice === 'schedule'} onClick={() => setRun({ choice: 'schedule' })} icon="calendarClock" title="Schedule" description="Run automatically. Scheduled runs only find and prepare — they never send." />
        <Choice
          checked={r.choice === 'save'}
          onClick={() => setRun({ choice: 'save' })}
          icon="check"
          title={editing ? 'Save changes only' : 'Save as draft'}
          description={editing ? 'Keep the existing schedules.' : 'Create the task without running or scheduling it yet.'}
        />
      </div>
      {r.choice === 'schedule' && (
        <div className="grid gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06] sm:grid-cols-3">
          <Field label="Date" hint={r.date ? ddmmyyyy(r.date) : 'DD/MM/YYYY'} htmlFor="lf-date">
            <Input id="lf-date" type="date" value={r.date} onChange={(e) => setRun({ date: e.target.value })} />
          </Field>
          <Field label="Time" htmlFor="lf-time">
            <Input id="lf-time" type="time" value={r.time} onChange={(e) => setRun({ time: e.target.value })} />
          </Field>
          <Field label="Repeat" htmlFor="lf-repeat">
            <Select id="lf-repeat" value={r.repeat} onChange={(e) => setRun({ repeat: e.target.value as Repeat })}>
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((k) => (
                <option key={k} value={k}>
                  {REPEAT_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </div>
  );
}

export function scheduleSummary(r: WizardState['run']): string {
  if (r.choice === 'now') return 'Run now';
  if (r.choice === 'save') return 'Saved without running';
  const at = `${r.time}`;
  switch (r.repeat) {
    case 'once':
      return `Once on ${ddmmyyyy(r.date)} at ${at}`;
    case 'daily':
      return `Daily at ${at}`;
    case 'weekly':
      return `Every ${new Date(`${r.date}T00:00`).toLocaleDateString('en-IN', { weekday: 'long' })} at ${at}`;
    case 'weekdays':
      return `Every weekday at ${at}`;
  }
}

// ---------------------------------------------------------------- 7 review
export function StepReview({ s, accounts }: { s: WizardState; accounts: AccountSummary[] }) {
  const c = s.config;
  const rows: Array<[string, ReactNode]> = [
    ['Task', s.name],
    ['Account', accounts.find((a) => a.id === s.accountId)?.name ?? '—'],
    ['Keywords', c.keywords || '—'],
    ['Job titles', c.jobTitles.join(', ') || 'Any'],
    ['Locations', c.locations.join(', ') || 'Anywhere'],
    ['Company', c.companies.join(', ') || 'Any'],
    ['Connection', DEGREE_LABEL[c.connectionDegree]],
    ...(c.industry ? ([['Industry', c.industry]] as Array<[string, ReactNode]>) : []),
    ...(c.currentCompany ? ([['Current company', c.currentCompany]] as Array<[string, ReactNode]>) : []),
    ...(c.schools.length ? ([['School', c.schools.join(', ')]] as Array<[string, ReactNode]>) : []),
    ...(c.profileKeywords.length ? ([['Profile keywords', c.profileKeywords.join(', ')]] as Array<[string, ReactNode]>) : []),
    ['Per run', `${c.maxLeads} results · ${c.maxCandidates} candidates`],
    ['Action', ACTION_LABEL[c.action]],
    ['Note', c.action === 'find_only' ? '—' : c.noteMode === 'none' ? 'No note' : <span className="whitespace-pre-wrap">{NOTE_MODE_LABEL[c.noteMode]}: “{c.note}”</span>],
    ['Run', scheduleSummary(s.run)],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-white/[0.05] rounded-xl ring-1 ring-inset ring-white/[0.06]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-3 px-4 py-2 text-sm">
            <dt className="text-slate-500">{k}</dt>
            <dd className="col-span-2 text-slate-100">{v}</dd>
          </div>
        ))}
      </dl>
      {c.action !== 'find_only' && (
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <Badge tone="amber">Review required</Badge>
          Connection requests are only sent when you confirm each one.
        </div>
      )}
    </div>
  );
}
