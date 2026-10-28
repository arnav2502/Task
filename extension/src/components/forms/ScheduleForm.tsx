import { useEffect, useMemo, useState } from 'react';
import type { Schedule, ScheduleFrequency, ScheduleMode, SchedulePreset, Task } from '@shared/types/index';
import { Button, Field, Input, Modal, Segmented, Select, Toggle } from '../ui';
import { api } from '../../services/api';
import { useApp } from '../../app/state';
import { useFeedback } from '../../app/feedback';
import { cx, dayName, todayIso } from '../../utils/format';

const GENERIC_PRESETS: SchedulePreset[] = [
  { label: 'Daily 9:00 AM', frequency: 'daily', time: '09:00' },
  { label: 'Weekdays 10 AM', frequency: 'specific_days', time: '10:00', daysOfWeek: [1, 2, 3, 4, 5] },
  { label: 'Mondays 11 AM', frequency: 'weekly', time: '11:00', daysOfWeek: [1] },
  { label: 'Hourly 9 AM–9 PM, random minute', frequency: 'hourly', time: '09:00', windowEnd: '21:00', randomMinute: true },
];

const FREQ_OPTIONS: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'specific_days', label: 'Specific days' },
  { value: 'hourly', label: 'Hourly window' },
];

/** Client-side mirror of the service's schedule validation (the service stays authoritative). */
export function validateScheduleDraft(d: { frequency: ScheduleFrequency; time: string; daysOfWeek: number[]; onceDate: string; windowEnd: string }): string | null {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(d.time)) return 'Pick a time.';
  if (d.frequency === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(d.onceDate)) return 'Pick a date.';
  if (d.frequency === 'weekly' && d.daysOfWeek.length !== 1) return 'Weekly schedules need exactly one day.';
  if (d.frequency === 'specific_days' && !d.daysOfWeek.length) return 'Pick at least one day.';
  if (d.frequency === 'hourly') {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(d.windowEnd)) return 'Pick when the hourly window ends.';
    if (Number(d.windowEnd.split(':')[0]) < Number(d.time.split(':')[0])) return 'The window must end after it starts.';
  }
  return null;
}

export function ScheduleFormModal({
  schedule,
  defaultTaskId,
  platformId,
  onClose,
  onSaved,
}: {
  schedule?: Schedule;
  defaultTaskId?: string;
  /** Limit the task picker to one platform. */
  platformId?: string;
  onClose: () => void;
  onSaved?: (s: Schedule) => void;
}) {
  const { platformById, settings } = useApp();
  const { toast } = useFeedback();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [taskId, setTaskId] = useState(schedule?.taskId ?? defaultTaskId ?? '');
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency ?? 'daily');
  const [time, setTime] = useState(schedule?.time ?? '09:00');
  const [daysOfWeek, setDays] = useState<number[]>(schedule?.daysOfWeek ?? [1, 2, 3, 4, 5]);
  const [onceDate, setOnceDate] = useState(schedule?.onceDate ?? todayIso());
  const [windowEnd, setWindowEnd] = useState(schedule?.windowEnd ?? '21:00');
  const [randomMinute, setRandomMinute] = useState(schedule?.randomMinute ?? true);
  const [mode, setMode] = useState<ScheduleMode>(schedule?.mode ?? 'default');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .tasks(platformId ? { platformId } : {})
      .then((t) => {
        setTasks(t);
        if (!taskId && t[0]) setTaskId(t[0].id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformId]);

  const task = tasks?.find((t) => t.id === taskId);
  const descriptor = task ? platformById(task.platformId)?.tasks.find((d) => d.type === task.taskType) : undefined;
  const presets = useMemo(() => [...(descriptor?.schedulePresets ?? []), ...GENERIC_PRESETS], [descriptor]);

  const applyPreset = (p: SchedulePreset) => {
    setFrequency(p.frequency);
    setTime(p.time);
    if (p.daysOfWeek) setDays(p.daysOfWeek);
    else if (p.frequency === 'hourly') setDays([]);
    if (p.windowEnd) setWindowEnd(p.windowEnd);
    setRandomMinute(p.randomMinute ?? p.frequency === 'hourly');
  };

  const toggleDay = (d: number) => {
    if (frequency === 'weekly') return setDays([d]);
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  };

  const submit = async () => {
    setError(null);
    if (!taskId) return setError('Choose a task.');
    const problem = validateScheduleDraft({ frequency, time, daysOfWeek, onceDate, windowEnd });
    if (problem) return setError(problem);
    const body = {
      frequency,
      time,
      daysOfWeek: frequency === 'daily' || frequency === 'once' ? [] : daysOfWeek,
      onceDate: frequency === 'once' ? onceDate : null,
      windowEnd: frequency === 'hourly' ? windowEnd : null,
      randomMinute: frequency === 'hourly' ? randomMinute : false,
      mode,
      enabled,
    };
    setBusy(true);
    try {
      const saved = schedule ? await api.updateSchedule(schedule.id, body) : await api.createSchedule({ taskId, ...body });
      toast('success', `Schedule saved — ${saved.summary}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const showDays = frequency === 'weekly' || frequency === 'specific_days' || frequency === 'hourly';

  return (
    <Modal
      title={schedule ? 'Edit schedule' : 'New schedule'}
      subtitle="Schedules run in the local service, even when this tab is closed."
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {schedule ? 'Save schedule' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Task" htmlFor="sch-task">
          <Select id="sch-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!!schedule || !tasks}>
            {!tasks && <option>Loading…</option>}
            {tasks?.length === 0 && <option value="">No tasks yet — add an account first</option>}
            {tasks?.map((t) => (
              <option key={t.id} value={t.id}>
                {platformById(t.platformId)?.name ?? t.platformId} · {t.accountName} · {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-300">Presets</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300 transition hover:border-indigo-400/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Frequency">
          <Segmented ariaLabel="Frequency" value={frequency} onChange={setFrequency} options={FREQ_OPTIONS} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={frequency === 'hourly' ? 'Window starts' : 'Time'} htmlFor="sch-time">
            <Input id="sch-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          {frequency === 'once' && (
            <Field label="Date" htmlFor="sch-date">
              <Input id="sch-date" type="date" value={onceDate} min={todayIso()} onChange={(e) => setOnceDate(e.target.value)} />
            </Field>
          )}
          {frequency === 'hourly' && (
            <Field label="Window ends (last run hour)" htmlFor="sch-end">
              <Input id="sch-end" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </Field>
          )}
        </div>

        {showDays && (
          <Field label={frequency === 'weekly' ? 'Day' : frequency === 'hourly' ? 'Days (none selected = every day)' : 'Days'}>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = daysOfWeek.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    className={cx(
                      'h-9 w-12 rounded-lg text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70',
                      on ? 'bg-indigo-500/25 text-white ring-1 ring-inset ring-indigo-400/50' : 'bg-white/[0.03] text-slate-400 ring-1 ring-inset ring-white/10 hover:text-white',
                    )}
                  >
                    {dayName(d)}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {frequency === 'hourly' && (
          <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
            <div>
              <div className="text-sm text-slate-200">Random minute</div>
              <div className="text-xs text-slate-500">Each hourly run picks a fresh minute (1–59), never on the hour.</div>
            </div>
            <Toggle checked={randomMinute} onChange={setRandomMinute} label="Random minute" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Browser mode" htmlFor="sch-mode">
            <Select id="sch-mode" value={mode} onChange={(e) => setMode(e.target.value as ScheduleMode)}>
              <option value="default">Default (account → global)</option>
              <option value="background">Background</option>
              <option value="headed">Headed</option>
              <option value="headless">Headless</option>
            </Select>
          </Field>
          <Field label="Enabled">
            <div className="flex h-9 items-center">
              <Toggle checked={enabled} onChange={setEnabled} label="Schedule enabled" />
            </div>
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          Missed runs (computer off or asleep) are{' '}
          <span className="text-slate-300">{settings?.missedPolicy === 'run' ? 'run 2–6 minutes after the service starts' : 'skipped and recorded in history'}</span>.{' '}
          <a href="#/settings" className="text-indigo-300 hover:underline" onClick={onClose}>
            Change in Settings
          </a>
        </p>

        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
