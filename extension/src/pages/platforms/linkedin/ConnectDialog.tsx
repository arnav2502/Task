/**
 * The ONLY place a LinkedIn connection request is sent from: one lead, one explicit
 * "Send Connection Request" click. Nothing here sends in bulk or without the dialog.
 */
import { useState } from 'react';
import type { ExecutionRun } from '@shared/types/index';
import type { Lead } from '@shared/types/linkedin';
import { LINKEDIN_NOTE_MAX } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useFeedback } from '../../../app/feedback';
import { Button, Callout, Field, Modal } from '../../../components/ui';
import { cx } from '../../../utils/format';
import { DegreeBadge, NoteEditor, leadSubtitle } from './common';

export function ConnectDialog({
  lead,
  initialNote,
  onClose,
  onSent,
  walkthrough,
}: {
  lead: Lead;
  initialNote: string | null;
  onClose: () => void;
  onSent: (run: ExecutionRun) => void;
  /** "Review selected": position in the walk-through, with a way to move on without sending. */
  walkthrough?: { index: number; total: number; onNext: () => void };
}) {
  const { toast, fail } = useFeedback();
  const [withNote, setWithNote] = useState(!!initialNote);
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = note.trim();
  const invalid = withNote && (!trimmed || trimmed.length > LINKEDIN_NOTE_MAX);

  const send = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      const run = await api.linkedin.confirmConnection(lead.id, withNote ? trimmed : null);
      toast('success', `Connection request to ${lead.name} queued (${run.id})`);
      onSent(run);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Connect with ${lead.name}?`}
      subtitle={walkthrough ? `Reviewing ${walkthrough.index + 1} of ${walkthrough.total}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {walkthrough ? 'Stop reviewing' : 'Cancel'}
          </Button>
          {walkthrough && (
            <Button variant="secondary" onClick={walkthrough.onNext}>
              Not now
            </Button>
          )}
          <Button variant="primary" icon="send" loading={busy} disabled={invalid} onClick={() => void send()}>
            Send Connection Request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{lead.name}</span>
            <DegreeBadge degree={lead.connectionDegree} />
          </div>
          <div className="mt-0.5 text-sm text-slate-300">{leadSubtitle(lead) || '—'}</div>
          {lead.location && <div className="text-xs text-slate-500">{lead.location}</div>}
          <a href={lead.profileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-indigo-300 hover:underline">
            View profile on LinkedIn ↗
          </a>
        </div>

        <Field label="Connection note">
          <div role="radiogroup" aria-label="Connection note" className="flex gap-2">
            {[
              { v: false, label: 'No note' },
              { v: true, label: 'Add note' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={withNote === o.v}
                onClick={() => setWithNote(o.v)}
                className={cx(
                  'flex-1 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition',
                  withNote === o.v ? 'bg-indigo-500/15 text-white ring-indigo-400/40' : 'text-slate-400 ring-white/10 hover:text-slate-200',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        {withNote && <NoteEditor value={note} onChange={setNote} autoFocus />}

        <Callout tone="indigo" icon="shield">
          TaskPilot opens {lead.name.split(' ')[0]}’s profile in your signed-in LinkedIn browser and sends this one request. It is marked
          <strong> sent</strong> only after LinkedIn shows it as pending.
        </Callout>
      </div>
    </Modal>
  );
}

/** Edit (or create) the prepared connection note of a lead without sending anything. */
export function NoteDialog({ lead, initialNote, onClose, onSaved }: { lead: Lead; initialNote: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useFeedback();
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await api.linkedin.saveDraft(lead.id, value);
      toast('success', value ? `Note saved for ${lead.name}` : `${lead.name} is ready to connect without a note`);
      onSaved();
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const trimmed = note.trim();
  return (
    <Modal
      title={`Connection note for ${lead.name}`}
      subtitle="Saved as a draft for your review — nothing is sent."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => void save(null)}>
            No note
          </Button>
          <Button variant="primary" loading={busy} disabled={!trimmed || trimmed.length > LINKEDIN_NOTE_MAX} onClick={() => void save(trimmed)}>
            Save note
          </Button>
        </>
      }
    >
      <NoteEditor value={note} onChange={setNote} autoFocus />
    </Modal>
  );
}
