import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanResumeFolder, filenameDateScore } from '../../automation-server/src/adapters/naukri/resumeFiles';
import { applyResponseCode, selectRoles, type RoleCard } from '../../automation-server/src/adapters/naukri/tasks/shareInterest';
import { parseUploadedOn } from '../../automation-server/src/adapters/naukri/tasks/resumeUpload';
import { sameText, toggleUpdateMarker } from '../../automation-server/src/adapters/naukri/toggleMarker';
import { makeTempDir, writePdf } from '../helpers/env';

describe('toggleUpdateMarker', () => {
  const h = 'Software Test Engineer | Playwright | Jira';
  it('adds the marker when absent and removes it when present', () => {
    expect(toggleUpdateMarker(h)).toEqual({ next: `${h}.`, action: 'added', baseline: h });
    expect(toggleUpdateMarker(`${h}.`)).toEqual({ next: h, action: 'removed', baseline: h });
  });
  it('ignores trailing whitespace and only touches the end', () => {
    expect(toggleUpdateMarker(`  ${h}   `).next).toBe(`  ${h}.`);
  });
  it('keeps a real trailing period once the baseline is known', () => {
    const real = 'I test software.';
    expect(toggleUpdateMarker(real, { baseline: real })).toMatchObject({ next: 'I test software..', action: 'added' });
    expect(toggleUpdateMarker('I test software..', { baseline: real })).toMatchObject({ next: real, action: 'removed' });
  });
  it('re-learns the baseline after a manual edit', () => {
    expect(toggleUpdateMarker('New headline', { baseline: 'Old headline' })).toEqual({ next: 'New headline.', action: 'added', baseline: 'New headline' });
  });
  it('supports a custom marker and refuses empty text', () => {
    expect(toggleUpdateMarker('abc', { marker: ' ✓' }).next).toBe('abc ✓');
    expect(() => toggleUpdateMarker('   ')).toThrow(/empty/);
    expect(() => toggleUpdateMarker('.')).toThrow(/only of the marker/);
  });
  it('compares saved text ignoring whitespace differences', () => {
    expect(sameText('a  b\n c', 'a b c')).toBe(true);
    expect(sameText('a b c.', 'a b c')).toBe(false);
  });
});

describe('resume folder scan', () => {
  it('picks the newest PDF, breaking mtime ties by the date in the name', async () => {
    const dir = makeTempDir('resumes');
    const t = new Date(2026, 9, 20, 10);
    writePdf(dir, 'Resume_2026-10-01.pdf', t);
    writePdf(dir, 'Resume_2026-10-15.pdf', t);
    writePdf(dir, 'Old.pdf', new Date(2026, 0, 1));
    writePdf(dir, 'notes.txt', new Date());
    const scan = await scanResumeFolder({ folderPath: dir, selectionMode: 'latest', specificFile: '' });
    expect(scan.error).toBeNull();
    expect(scan.files.map((f) => f.name)).toEqual(['Resume_2026-10-15.pdf', 'Resume_2026-10-01.pdf', 'Old.pdf']);
    expect(scan.selected?.name).toBe('Resume_2026-10-15.pdf');
  });

  it('selects a specific file and reports a missing one', async () => {
    const dir = makeTempDir('resumes');
    writePdf(dir, 'A.pdf', new Date(2026, 9, 1));
    writePdf(dir, 'B.pdf', new Date(2026, 9, 2));
    expect((await scanResumeFolder({ folderPath: dir, selectionMode: 'specific', specificFile: 'A.pdf' })).selected?.name).toBe('A.pdf');
    const missing = await scanResumeFolder({ folderPath: dir, selectionMode: 'specific', specificFile: 'C.pdf' });
    expect(missing.selected).toBeNull();
    expect(missing.error).toMatch(/not in the folder/);
  });

  it('flags files over 2 MB and handles missing / empty folders', async () => {
    const dir = makeTempDir('resumes');
    writePdf(dir, 'Big.pdf', new Date(), 3 * 1024 * 1024);
    const big = await scanResumeFolder({ folderPath: dir, selectionMode: 'latest', specificFile: '' });
    expect(big.selected?.tooLarge).toBe(true);
    expect(big.error).toMatch(/2 MB/);
    expect((await scanResumeFolder({ folderPath: path.join(dir, 'nope'), selectionMode: 'latest', specificFile: '' })).error).toMatch(/does not exist/);
    expect((await scanResumeFolder({ folderPath: makeTempDir('empty'), selectionMode: 'latest', specificFile: '' })).error).toMatch(/No PDF/);
    expect((await scanResumeFolder({ folderPath: '', selectionMode: 'latest', specificFile: '' })).error).toMatch(/No resume folder/);
  });

  it('extracts dates from file names', () => {
    expect(filenameDateScore('cv_2026-10-14.pdf')).toBe(20261014);
    expect(filenameDateScore('cv_14-10-2026.pdf')).toBe(20261014);
    expect(filenameDateScore('cv 2025.pdf')).toBe(20250000);
    expect(filenameDateScore('cv.pdf')).toBe(0);
  });
});

describe('Naukri page parsing', () => {
  it('parses "Uploaded on" labels', () => {
    expect(parseUploadedOn('Uploaded on Oct 14, 2026')).toEqual(new Date(2026, 9, 14));
    expect(parseUploadedOn('Uploaded on 14 Oct 2026')).toEqual(new Date(2026, 9, 14));
    const now = new Date(2026, 9, 26, 15);
    expect(parseUploadedOn('Uploaded Today', now)).toEqual(new Date(2026, 9, 26));
    expect(parseUploadedOn('garbage')).toBeNull();
  });

  it('reads the per-role apply code from the confirmation URL', () => {
    const url = (resp: object) => `https://x/myapply/saveApply?strJobsarr=[1]&multiApplyResp=${encodeURIComponent(JSON.stringify(resp))}`;
    expect(applyResponseCode(url({ '111': 200 }), '111')).toBe(200);
    expect(applyResponseCode(url({ '111': 409 }), '111')).toBe(409);
    expect(applyResponseCode(url({ '222': 200 }), '111')).toBeNull();
    expect(applyResponseCode('https://x/mnjuser/recommended-earjobs', '111')).toBeNull();
  });
});

describe('selectRoles', () => {
  const card = (jobId: string, title: string, skills: string[] = [], company = 'Co'): RoleCard => ({
    jobId,
    title,
    company,
    experience: null,
    salary: null,
    location: null,
    skills,
  });
  const cards = [card('1', 'QA Engineer', ['Selenium']), card('2', 'Sales Executive'), card('3', 'SDET', ['Playwright']), card('4', 'Senior QA Lead'), card('1', 'dup')];

  it('drops already attempted roles and duplicates, applies the limit', () => {
    const picked = selectRoles(cards, { already: new Set(['3']), include: [], exclude: [], limit: 10, rng: () => 0.5 });
    expect(picked.map((c) => c.jobId).sort()).toEqual(['1', '2', '4']);
    expect(selectRoles(cards, { already: new Set(), include: [], exclude: [], limit: 2 })).toHaveLength(2);
  });

  it('matches include / exclude keywords on title, company and skills, case-insensitively', () => {
    const picked = selectRoles(cards, { already: new Set(), include: ['qa', 'playwright'], exclude: ['SENIOR'], limit: 10 });
    expect(picked.map((c) => c.jobId).sort()).toEqual(['1', '3']);
  });

  it('shuffles with the injected random source', () => {
    const order = (v: number) => selectRoles(cards, { already: new Set(), include: [], exclude: [], limit: 10, rng: () => v }).map((c) => c.jobId);
    expect(order(0)).not.toEqual(order(0.99));
  });
});
