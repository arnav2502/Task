/** LinkedIn defaults for new lead tasks (platform-level LEAD_FINDER configuration). */
import { useEffect, useState } from 'react';
import type { PlatformDescriptor } from '@shared/types/index';
import type { LeadFinderConfig } from '@shared/types/linkedin';
import { LINKEDIN_NOTE_MAX } from '@shared/types/linkedin';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Button, Card, CardHeader, ErrorBanner, Field, Input, Skeleton } from '../../../components/ui';
import { DEFAULT_TEMPLATE, LEAD_FINDER, NoteEditor, PLATFORM, SAMPLE_LEAD, fillTemplate } from './common';
import { FALLBACK_CONFIG } from './wizard/LeadFinderWizard';

export function SettingsTab({ platform }: { platform: PlatformDescriptor }) {
  const { toast, fail } = useFeedback();
  const { data, error, reload } = useResource(async () => {
    const base = { ...FALLBACK_CONFIG, ...(platform.tasks.find((t) => t.type === LEAD_FINDER)?.defaultConfig as Partial<LeadFinderConfig> | undefined) };
    const { configuration } = await api.platformTaskConfig(PLATFORM, LEAD_FINDER);
    return { ...base, ...(configuration as Partial<LeadFinderConfig>) };
  }, []);
  const [draft, setDraft] = useState<LeadFinderConfig | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(data), [data]);

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (!draft) return <Skeleton className="h-72" />;
  const template = draft.note || '';
  const tooLong = fillTemplate(template, SAMPLE_LEAD).length > LINKEDIN_NOTE_MAX;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  const save = async () => {
    setBusy(true);
    try {
      await api.savePlatformTaskConfig(PLATFORM, LEAD_FINDER, draft as unknown as Record<string, unknown>);
      toast('success', 'LinkedIn defaults saved');
      void reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Defaults for new lead tasks"
        subtitle="Used by the Lead Finder wizard and by tasks that don’t override them."
        icon="sliders"
        action={
          <Button variant="primary" icon="check" loading={busy} disabled={!dirty || tooLong} onClick={() => void save()}>
            Save
          </Button>
        }
      />
      <div className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Results to read per run" hint="Kept small on purpose (1–50)." htmlFor="li-max">
            <Input id="li-max" type="number" min={1} max={50} value={draft.maxLeads} onChange={(e) => setDraft({ ...draft, maxLeads: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Connection candidates per run" hint="Prepared for your review (1–25)." htmlFor="li-cand">
            <Input id="li-cand" type="number" min={1} max={25} value={draft.maxCandidates} onChange={(e) => setDraft({ ...draft, maxCandidates: Math.max(1, Math.min(25, Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        <Field label="Default note template" hint="Pre-filled when a task uses a note. Placeholders are filled per lead." htmlFor="li-note">
          <NoteEditor id="li-note" value={template} onChange={(note) => setDraft({ ...draft, note })} template />
        </Field>
        {!template && (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setDraft({ ...draft, note: DEFAULT_TEMPLATE })}>
            Use the suggested template
          </Button>
        )}
      </div>
    </Card>
  );
}
