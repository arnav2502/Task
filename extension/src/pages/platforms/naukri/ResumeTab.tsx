import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlatformDescriptor, Task } from '@shared/types/index';
import { NAUKRI_MAX_RESUME_BYTES, NAUKRI_TASKS, type ResumeFolderScan, type ResumeUploadConfig } from '@shared/types/naukri';
import { api } from '../../../services/api';
import { useResource } from '../../../app/state';
import { useFeedback } from '../../../app/feedback';
import { Badge, Button, Card, CardHeader, Callout, EmptyState, ErrorBanner, Field, Input, Segmented, Select, Skeleton } from '../../../components/ui';
import { TaskConfigModal } from '../../../components/forms/ConfigFields';
import { Icon } from '../../../components/icons';
import { formatBytes, formatDateTime } from '../../../utils/format';

const PLATFORM = 'naukri';

function toConfig(raw: Record<string, unknown> | undefined): ResumeUploadConfig {
  return {
    folderPath: typeof raw?.folderPath === 'string' ? raw.folderPath : '',
    selectionMode: raw?.selectionMode === 'specific' ? 'specific' : 'latest',
    specificFile: typeof raw?.specificFile === 'string' ? raw.specificFile : '',
  };
}

function ScanTable({ scan }: { scan: ResumeFolderScan }) {
  if (!scan.files.length)
    return <EmptyState icon="file" title="No PDF files in this folder" description="Naukri accepts PDF resumes up to 2 MB. Drop your resume PDF into the folder and rescan." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-5 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 font-medium">Modified</th>
            <th className="px-5 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {scan.files.map((f) => {
            const tooLarge = f.tooLarge || f.sizeBytes > NAUKRI_MAX_RESUME_BYTES;
            return (
              <tr key={f.path} className={scan.selected?.path === f.path ? 'bg-indigo-500/[0.06]' : undefined}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2 text-slate-100">
                    <Icon name="file" size={15} className="text-rose-300/80" />
                    <span className="truncate" title={f.path}>
                      {f.name}
                    </span>
                  </div>
                </td>
                <td className={tooLarge ? 'px-3 py-2.5 text-rose-300' : 'px-3 py-2.5 text-slate-400'}>{formatBytes(f.sizeBytes)}</td>
                <td className="px-3 py-2.5 text-slate-400">{formatDateTime(f.modifiedAt)}</td>
                <td className="px-5 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    {scan.latest?.path === f.path && <Badge tone="cyan">LATEST</Badge>}
                    {scan.selected?.path === f.path && <Badge tone="green">WILL UPLOAD</Badge>}
                    {tooLarge && <Badge tone="red">Over 2 MB</Badge>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountOverrideRow({ task, descriptor, onChanged }: { task: Task; descriptor: PlatformDescriptor['tasks'][number] | undefined; onChanged: () => void }) {
  const { toast, fail } = useFeedback();
  const [scan, setScan] = useState<ResumeFolderScan | null>(null);
  const [editing, setEditing] = useState(false);
  const cfg = toConfig(task.configuration);

  useEffect(() => {
    api.naukri
      .scanFor(task.accountId)
      .then(setScan)
      .catch(() => setScan(null));
  }, [task.accountId, task.updatedAt]);

  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-3">
      <div className="min-w-[200px] flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-100">{task.accountName}</span>
          {task.hasConfigOverride ? <Badge tone="violet">Custom folder</Badge> : <Badge tone="slate">Uses default</Badge>}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={cfg.folderPath}>
          {cfg.folderPath || 'No folder configured'} · {cfg.selectionMode === 'latest' ? 'latest PDF' : `specific: ${cfg.specificFile || '—'}`}
        </div>
        <div className="mt-1 text-xs">
          {scan?.selected ? (
            <span className="text-emerald-300/90">Next upload: {scan.selected.name}</span>
          ) : (
            <span className="text-amber-300/90">{scan?.error ?? 'Checking…'}</span>
          )}
        </div>
      </div>
      <Button size="sm" icon="sliders" onClick={() => setEditing(true)}>
        {task.hasConfigOverride ? 'Edit override' : 'Override'}
      </Button>
      {task.hasConfigOverride && (
        <Button
          size="sm"
          variant="ghost"
          icon="rotate"
          onClick={async () => {
            try {
              await api.updateTask(task.id, { resetConfiguration: true });
              toast('success', `${task.accountName} now uses the default folder`);
              onChanged();
            } catch (err) {
              fail(err);
            }
          }}
        >
          Use default
        </Button>
      )}
      {editing && descriptor && <TaskConfigModal task={task} descriptor={descriptor} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </li>
  );
}

export function ResumeTab({ platform }: { platform: PlatformDescriptor }) {
  const { toast, fail } = useFeedback();
  const descriptor = platform.tasks.find((t) => t.type === NAUKRI_TASKS.RESUME_UPLOAD);
  const saved = useResource(() => api.platformTaskConfig(PLATFORM, NAUKRI_TASKS.RESUME_UPLOAD), []);
  const tasks = useResource(() => api.tasks({ platformId: PLATFORM }), [], ['tasks:changed', 'account:update', 'account:deleted']);
  const [draft, setDraft] = useState<ResumeUploadConfig | null>(null);
  const [scan, setScan] = useState<ResumeFolderScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanSeq = useRef(0);

  useEffect(() => {
    if (saved.data && !draft) setDraft(toConfig(saved.data.configuration));
  }, [saved.data, draft]);

  const rescan = async (cfg: ResumeUploadConfig | null = draft) => {
    if (!cfg) return;
    if (!cfg.folderPath.trim()) {
      setScan(null);
      return;
    }
    const my = ++scanSeq.current;
    setScanning(true);
    try {
      const r = await api.naukri.previewScan({ folderPath: cfg.folderPath.trim(), selectionMode: cfg.selectionMode, specificFile: cfg.specificFile || undefined });
      if (my === scanSeq.current) setScan(r);
    } catch (err) {
      if (my === scanSeq.current) setScan({ folderPath: cfg.folderPath, exists: false, files: [], latest: null, selected: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (my === scanSeq.current) setScanning(false);
    }
  };

  // Debounced live preview while editing
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => void rescan(draft), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.folderPath, draft?.selectionMode, draft?.specificFile]);

  const dirty = useMemo(() => {
    if (!draft || !saved.data) return false;
    const s = toConfig(saved.data.configuration);
    return s.folderPath !== draft.folderPath || s.selectionMode !== draft.selectionMode || s.specificFile !== draft.specificFile;
  }, [draft, saved.data]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api.savePlatformTaskConfig(PLATFORM, NAUKRI_TASKS.RESUME_UPLOAD, { ...draft, folderPath: draft.folderPath.trim() });
      saved.setData(r);
      toast('success', 'Default resume folder saved');
      void tasks.reload();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const browse = async () => {
    try {
      const r = await api.pickFolder(draft?.folderPath || undefined);
      if (r.path && draft) setDraft({ ...draft, folderPath: r.path });
    } catch (err) {
      fail(err);
    }
  };

  const resumeTasks = (tasks.data ?? []).filter((t) => t.taskType === NAUKRI_TASKS.RESUME_UPLOAD);

  return (
    <div className="space-y-5">
      <Callout tone="indigo" icon="info" title="How Resume Upload picks a file">
        The folder is scanned right before every upload, so replacing the PDF is all you need to do. Only PDF files up to 2 MB are uploaded, under their real file name, and the upload is
        verified by reloading your profile (file name + “Uploaded on” today).
      </Callout>

      <Card>
        <CardHeader
          icon="folder"
          title="Default resume folder"
          subtitle="Used by every Naukri account without its own override."
          action={
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
              Save
            </Button>
          }
        />
        <div className="space-y-4 px-5 py-4">
          {saved.error && <ErrorBanner message={saved.error} onRetry={() => void saved.reload()} />}
          {!draft ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <Field label="Folder" htmlFor="resume-folder">
                <div className="flex gap-2">
                  <Input id="resume-folder" value={draft.folderPath} onChange={(e) => setDraft({ ...draft, folderPath: e.target.value })} placeholder="C:\\Users\\you\\Documents\\Resume" />
                  <Button icon="folder" onClick={() => void browse()}>
                    Browse…
                  </Button>
                  <Button icon="refresh" variant="ghost" onClick={() => void rescan()} loading={scanning}>
                    Rescan
                  </Button>
                </div>
              </Field>
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Which PDF to upload">
                  <Segmented
                    ariaLabel="Which PDF to upload"
                    value={draft.selectionMode}
                    onChange={(v) => setDraft({ ...draft, selectionMode: v })}
                    options={[
                      { value: 'latest', label: 'Latest PDF' },
                      { value: 'specific', label: 'Specific PDF' },
                    ]}
                  />
                </Field>
                {draft.selectionMode === 'specific' && (
                  <div className="min-w-[260px] flex-1">
                    <Field label="File" htmlFor="resume-file">
                      <Select id="resume-file" value={draft.specificFile} onChange={(e) => setDraft({ ...draft, specificFile: e.target.value })}>
                        <option value="">Choose a PDF…</option>
                        {scan?.files.map((f) => (
                          <option key={f.path} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="border-t border-white/[0.05]">
          {scanning && !scan && <Skeleton className="m-5 h-20" />}
          {!draft?.folderPath && !scanning && <div className="px-5 py-6 text-center text-sm text-slate-500">Choose a folder to see its PDF files.</div>}
          {scan && draft?.folderPath && (
            <>
              {scan.error && (
                <div className="flex items-center gap-2 px-5 py-3 text-sm text-amber-200">
                  <Icon name="alert" size={15} />
                  {scan.error}
                </div>
              )}
              {scan.exists && <ScanTable scan={scan} />}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon="accounts" title="Per-account override" subtitle="Give an account its own folder or a specific file." />
        {tasks.loading && !tasks.data ? (
          <Skeleton className="m-5 h-16" />
        ) : resumeTasks.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-500">No Naukri accounts yet.</div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {resumeTasks.map((t) => (
              <AccountOverrideRow key={t.id} task={t} descriptor={descriptor} onChanged={() => void tasks.reload()} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
