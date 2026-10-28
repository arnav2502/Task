import fs from 'node:fs/promises';
import path from 'node:path';
import { NAUKRI_MAX_RESUME_BYTES, type ResumeFileInfo, type ResumeFolderScan, type ResumeUploadConfig } from '@shared/types/naukri.js';

/** Sortable date hint from a filename: 2026-10-14, 14-10-2026, 20261014 or a bare year. */
export function filenameDateScore(name: string): number {
  const base = name.toLowerCase();
  let m = base.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])/);
  if (m) return Number(`${m[1]}${m[2]}${m[3]}`);
  m = base.match(/([0-2]\d|3[01])[-_.](0[1-9]|1[0-2])[-_.](20\d{2})/);
  if (m) return Number(`${m[3]}${m[2]}${m[1]}`);
  m = base.match(/(20\d{2})/);
  if (m) return Number(`${m[1]}0000`);
  return 0;
}

/** Newest modification time first; ties broken by the date in the file name, then by name. */
export function compareResumes(a: ResumeFileInfo, b: ResumeFileInfo): number {
  return (
    Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) || filenameDateScore(b.name) - filenameDateScore(a.name) || b.name.localeCompare(a.name)
  );
}

export async function listPdfs(folderPath: string): Promise<ResumeFileInfo[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files: ResumeFileInfo[] = [];
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== '.pdf') continue;
    const full = path.join(folderPath, e.name);
    try {
      const st = await fs.stat(full);
      files.push({ name: e.name, path: full, sizeBytes: st.size, modifiedAt: st.mtime.toISOString(), tooLarge: st.size > NAUKRI_MAX_RESUME_BYTES });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return files.sort(compareResumes);
}

/** Scan fresh (right before every upload) and resolve the file to upload. PDF only. */
export async function scanResumeFolder(cfg: Pick<ResumeUploadConfig, 'folderPath' | 'selectionMode' | 'specificFile'>): Promise<ResumeFolderScan> {
  const folderPath = cfg.folderPath.trim();
  const empty: ResumeFolderScan = { folderPath, exists: false, files: [], latest: null, selected: null, error: null };
  if (!folderPath) return { ...empty, error: 'No resume folder configured' };
  try {
    if (!(await fs.stat(folderPath)).isDirectory()) return { ...empty, error: 'The configured path is not a folder' };
  } catch {
    return { ...empty, error: 'The resume folder does not exist' };
  }
  try {
    const files = await listPdfs(folderPath);
    const latest = files[0] ?? null;
    let selected: ResumeFileInfo | null = latest;
    let error: string | null = files.length ? null : 'No PDF files in the resume folder';
    if (cfg.selectionMode === 'specific') {
      selected = files.find((f) => f.name === cfg.specificFile) ?? null;
      if (!selected) error = cfg.specificFile ? `The selected resume "${cfg.specificFile}" is not in the folder` : 'No specific PDF selected';
    }
    if (selected?.tooLarge) error = `${selected.name} is ${(selected.sizeBytes / 1024 / 1024).toFixed(2)} MB — Naukri accepts up to 2 MB`;
    return { folderPath, exists: true, files, latest, selected, error };
  } catch (err) {
    return { ...empty, exists: true, error: `Cannot read the folder: ${(err as Error).message}` };
  }
}
