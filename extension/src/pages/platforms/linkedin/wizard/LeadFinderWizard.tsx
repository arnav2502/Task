/**
 * LinkedIn Lead Finder — a step-by-step wizard that creates (or edits) a LEAD_FINDER task: a generic,
 * multi-instance TaskPilot task with its own configuration and schedules.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PlatformDescriptor } from '@shared/types/index';
import type { LeadFinderConfig } from '@shared/types/linkedin';
import { LINKEDIN_NOTE_MAX } from '@shared/types/linkedin';
import { api, type ScheduleInput } from '../../../../services/api';
import { useResource } from '../../../../app/state';
import { useFeedback } from '../../../../app/feedback';
import { Button, Card, ErrorBanner, Skeleton } from '../../../../components/ui';
import { AccountFormModal } from '../../../../components/forms/AccountForm';
import { Icon } from '../../../../components/icons';
import { cx, todayIso } from '../../../../utils/format';
import { LEAD_FINDER, PLATFORM, SAMPLE_LEAD, fillTemplate, tabHref, useHashQuery } from '../common';
import {
  OPTIONAL_FILTERS,
  StepAction,
  StepBasics,
  StepFilters,
  StepNote,
  StepReview,
  StepRun,
  StepSearch,
  filterHasValue,
  type Patch,
  type WizardState,
} from './steps';

/** Used when the service has no defaults yet. */
export const FALLBACK_CONFIG: LeadFinderConfig = {
  keywords: '',
  jobTitles: [],
  locations: [],
  companies: [],
  currentCompany: '',
  industry: '',
  schools: [],
  profileKeywords: [],
  connectionDegree: '2nd',
  action: 'prepare_connection',
  noteMode: 'none',
  note: '',
  maxLeads: 20,
  maxCandidates: 10,
};

const STEPS = ['Name', 'Search', 'Filters', 'Action', 'Note', 'Run', 'Review'] as const;

function validate(step: number, s: WizardState): string | null {
  const c = s.config;
  switch (step) {
    case 0:
      if (!s.name.trim()) return 'Give the task a name.';
      if (!s.accountId) return 'Add a LinkedIn account first.';
      return null;
    case 1:
      return c.keywords.trim() || c.jobTitles.length ? null : 'Enter keywords or at least one job title.';
    case 4:
      if (c.action === 'find_only' || c.noteMode === 'none') return null;
      if (!c.note.trim()) return 'Write the connection note, or choose “No note”.';
      if ((c.noteMode === 'personalized' ? fillTemplate(c.note, SAMPLE_LEAD) : c.note.trim()).length > LINKEDIN_NOTE_MAX)
        return `The note must be ${LINKEDIN_NOTE_MAX} characters or fewer.`;
      return null;
    case 5:
      if (s.run.choice !== 'schedule') return null;
      if (!s.run.time) return 'Pick a time.';
      if ((s.run.repeat === 'once' || s.run.repeat === 'weekly') && !s.run.date) return 'Pick a date.';
      if (s.run.repeat === 'once' && new Date(`${s.run.date}T${s.run.time}`).getTime() <= Date.now()) return 'That date and time is in the past.';
      return null;
    default:
      return null;
  }
}

function toSchedule(taskId: string, r: WizardState['run']): ScheduleInput {
  switch (r.repeat) {
    case 'once':
      return { taskId, frequency: 'once', time: r.time, onceDate: r.date };
    case 'daily':
      return { taskId, frequency: 'daily', time: r.time };
    case 'weekly':
      return { taskId, frequency: 'weekly', time: r.time, daysOfWeek: [new Date(`${r.date}T00:00`).getDay()] };
    case 'weekdays':
      return { taskId, frequency: 'specific_days', time: r.time, daysOfWeek: [1, 2, 3, 4, 5] };
  }
}

export function LeadFinderTab({ platform }: { platform: PlatformDescriptor }) {
  const query = useHashQuery();
  const editId = query.get('edit');
  const accounts = useResource(() => api.accounts(PLATFORM), [], ['account:update', 'account:deleted']);
  const defaults = useResource(async () => {
    const base = { ...FALLBACK_CONFIG, ...(platform.tasks.find((t) => t.type === LEAD_FINDER)?.defaultConfig as Partial<LeadFinderConfig> | undefined) };
    try {
      const { configuration } = await api.platformTaskConfig(PLATFORM, LEAD_FINDER);
      return { ...base, ...(configuration as Partial<LeadFinderConfig>) };
    } catch {
      return base;
    }
  }, []);
  const editing = useResource(() => (editId ? api.task(editId) : Promise.resolve(null)), [editId]);

  if (accounts.error) return <ErrorBanner message={accounts.error} onRetry={() => void accounts.reload()} />;
  if (!accounts.data || !defaults.data || (editId && !editing.data && !editing.error)) return <Skeleton className="h-96" />;
  if (editing.error) return <ErrorBanner message={editing.error} />;

  const task = editing.data;
  const initial: WizardState = {
    name: task?.name ?? '',
    accountId: task?.accountId ?? accounts.data[0]?.id ?? '',
    config: { ...defaults.data, ...((task?.configuration ?? {}) as Partial<LeadFinderConfig>) },
    run: { choice: task ? 'save' : 'now', date: todayIso(), time: '10:00', repeat: 'weekdays' },
  };
  return <Wizard key={task?.id ?? 'new'} initial={initial} editingId={task?.id ?? null} accounts={accounts.data} reloadAccounts={() => void accounts.reload()} />;
}

function Wizard({
  initial,
  editingId,
  accounts,
  reloadAccounts,
}: {
  initial: WizardState;
  editingId: string | null;
  accounts: NonNullable<Awaited<ReturnType<typeof api.accounts>>>;
  reloadAccounts: () => void;
}) {
  const { toast, fail } = useFeedback();
  const [s, setS] = useState<WizardState>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [shownFilters, setShownFilters] = useState(() => OPTIONAL_FILTERS.filter((f) => filterHasValue(initial.config, f.key)).map((f) => f.key));
  const patch: Patch = (fn) => setS(fn);

  // A newly added account becomes the selected one.
  useEffect(() => {
    if (!s.accountId && accounts[0]) setS((x) => ({ ...x, accountId: accounts[0]!.id }));
  }, [accounts, s.accountId]);

  const last = STEPS.length - 1;
  const next = () => {
    const err = validate(step, s);
    setError(err);
    if (!err) setStep((n) => Math.min(last, n + 1));
  };
  const back = () => {
    setError(null);
    setStep((n) => Math.max(0, n - 1));
  };
  const jump = (n: number) => {
    // Only allow jumping back, or forward through already valid steps.
    for (let i = 0; i < n; i++) {
      const err = validate(i, s);
      if (err) {
        setStep(i);
        setError(err);
        return;
      }
    }
    setError(null);
    setStep(n);
  };

  const configuration = useMemo(() => {
    const c = { ...s.config, keywords: s.config.keywords.trim(), note: s.config.action === 'find_only' || s.config.noteMode === 'none' ? s.config.note : s.config.note.trim() };
    return c as unknown as Record<string, unknown>;
  }, [s.config]);

  const submit = async () => {
    for (let i = 0; i < last; i++) {
      const err = validate(i, s);
      if (err) {
        setStep(i);
        setError(err);
        return;
      }
    }
    setBusy(true);
    try {
      const task = editingId
        ? await api.updateTask(editingId, { name: s.name.trim(), configuration })
        : await api.createTask({ accountId: s.accountId, taskType: LEAD_FINDER, name: s.name.trim(), configuration });
      if (s.run.choice === 'now') {
        const run = await api.runTask(task.id);
        toast('success', `${task.name} ${editingId ? 'saved' : 'created'} and running (${run.id}). You’ll be notified when leads are ready to review.`);
      } else if (s.run.choice === 'schedule') {
        await api.createSchedule(toSchedule(task.id, s.run));
        toast('success', `${task.name} ${editingId ? 'saved' : 'created'} and scheduled`);
      } else toast('success', editingId ? `${task.name} saved` : `${task.name} saved as a draft`);
      location.hash = tabHref('tasks');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/[0.05] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">{editingId ? `Edit “${initial.name}”` : 'Create LinkedIn lead task'}</h3>
            <p className="text-xs text-slate-400">Find people, prepare connection requests, and review them before anything is sent.</p>
          </div>
          {editingId && (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => (location.hash = tabHref('finder'))}>
              New task instead
            </Button>
          )}
        </div>
        <ol className="mt-4 flex flex-wrap gap-1.5" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => jump(i)}
                aria-current={i === step ? 'step' : undefined}
                className={cx(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition',
                  i === step ? 'bg-indigo-500/20 text-white ring-indigo-400/50' : i < step ? 'text-emerald-300 ring-emerald-400/25' : 'text-slate-500 ring-white/10 hover:text-slate-300',
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="px-5 py-5">
        {step === 0 && <StepBasics s={s} patch={patch} accounts={accounts} onAddAccount={() => setAddingAccount(true)} />}
        {step === 1 && <StepSearch s={s} patch={patch} />}
        {step === 2 && <StepFilters s={s} patch={patch} shown={shownFilters} setShown={setShownFilters} />}
        {step === 3 && <StepAction s={s} patch={patch} />}
        {step === 4 && <StepNote s={s} patch={patch} />}
        {step === 5 && <StepRun s={s} patch={patch} editing={!!editingId} />}
        {step === 6 && <StepReview s={s} accounts={accounts} />}
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.05] px-5 py-3">
        <Button variant="ghost" icon="chevronLeft" onClick={back} disabled={step === 0}>
          Back
        </Button>
        <span className="text-xs text-slate-500">
          Step {step + 1} of {STEPS.length}
        </span>
        {step < last ? (
          <Button variant="primary" onClick={next}>
            Next
          </Button>
        ) : (
          <Button variant="primary" icon="check" loading={busy} onClick={() => void submit()}>
            {editingId ? 'Save task' : 'Create task'}
          </Button>
        )}
      </div>

      {addingAccount && (
        <AccountFormModal
          defaultPlatformId={PLATFORM}
          onClose={() => setAddingAccount(false)}
          onSaved={(a) => {
            setS((x) => ({ ...x, accountId: a.id }));
            reloadAccounts();
          }}
        />
      )}
    </Card>
  );
}
