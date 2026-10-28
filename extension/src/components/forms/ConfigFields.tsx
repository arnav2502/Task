/**
 * Renders a task's configuration form from its descriptor's `configFields` — no platform-specific
 * code, so new platforms' tasks get a settings form for free.
 */
import { useState } from 'react';
import type { ConfigField, Task, TaskTypeDescriptor } from '@shared/types/index';
import { Button, Callout, Field, Input, Modal, Select, TagInput, Toggle } from '../ui';
import { api } from '../../services/api';
import { useFeedback } from '../../app/feedback';

type Values = Record<string, unknown>;

export function ConfigFieldInput({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cfg-${field.key}`;
  const { fail } = useFeedback();
  switch (field.type) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            className="max-w-[160px]"
          />
          {field.unit && <span className="text-xs text-slate-500">{field.unit}</span>}
        </div>
      );
    case 'boolean':
      return <Toggle checked={value === true} onChange={onChange} label={field.label} />;
    case 'text':
      return <Input id={id} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />;
    case 'tags':
      return <TagInput id={id} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} placeholder={field.placeholder ?? 'Type and press Enter'} />;
    case 'select':
      return (
        <Select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'folder':
      return (
        <div className="flex gap-2">
          <Input id={id} value={typeof value === 'string' ? value : ''} placeholder="C:\\Users\\you\\Documents\\Resumes" onChange={(e) => onChange(e.target.value)} />
          <Button
            icon="folder"
            onClick={async () => {
              try {
                const r = await api.pickFolder(typeof value === 'string' && value ? value : undefined);
                if (r.path) onChange(r.path);
              } catch (err) {
                fail(err);
              }
            }}
          >
            Browse…
          </Button>
        </div>
      );
  }
}

export function ConfigForm({ fields, values, onChange }: { fields: ConfigField[]; values: Values; onChange: (v: Values) => void }) {
  if (!fields.length) return <p className="text-sm text-slate-400">This task has no settings.</p>;
  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help} htmlFor={`cfg-${f.key}`}>
          <ConfigFieldInput field={f} value={values[f.key]} onChange={(v) => onChange({ ...values, [f.key]: v })} />
        </Field>
      ))}
    </div>
  );
}

/** Edit one task's per-account configuration override. */
export function TaskConfigModal({ task, descriptor, onClose, onSaved }: { task: Task; descriptor: TaskTypeDescriptor; onClose: () => void; onSaved: (t: Task) => void }) {
  const [values, setValues] = useState<Values>({ ...task.configuration });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.updateTask(task.id, { configuration: values });
      toast('success', `${task.name} settings saved for ${task.accountName}`);
      onSaved(t);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const t = await api.updateTask(task.id, { resetConfiguration: true });
      toast('success', 'Reverted to the platform defaults');
      onSaved(t);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Configure ${task.name}`}
      subtitle={`${task.accountName} · ${task.hasConfigOverride ? 'Custom settings for this account' : 'Using platform defaults'}`}
      onClose={onClose}
      footer={
        <>
          {task.hasConfigOverride && (
            <Button variant="ghost" icon="rotate" onClick={reset} disabled={busy} className="mr-auto">
              Use platform defaults
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {descriptor.effect === 'apply' && (
          <Callout title="This task submits applications">Each run applies on your behalf. Keep limits conservative.</Callout>
        )}
        <ConfigForm fields={descriptor.configFields} values={values} onChange={setValues} />
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  );
}
