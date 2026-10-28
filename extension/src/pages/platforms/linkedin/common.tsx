/** Shared LinkedIn UI pieces: badges, note templating, hash-query helpers, the note editor. */
import { useEffect, useRef, useState } from 'react';
import type { ConnectionDegree, Lead, LeadFinderConfig, LeadStatus } from '@shared/types/linkedin';
import { LINKEDIN_NOTE_MAX, NOTE_PLACEHOLDERS } from '@shared/types/linkedin';
import { Badge, type Tone } from '../../../components/ui';
import { cx } from '../../../utils/format';

export const PLATFORM = 'linkedin';
export const LEAD_FINDER = 'LEAD_FINDER';

const LEAD: Record<LeadStatus, { tone: Tone; label: string }> = {
  NEW: { tone: 'blue', label: 'New' },
  REVIEWED: { tone: 'slate', label: 'Reviewed' },
  SELECTED: { tone: 'violet', label: 'Selected' },
  SKIPPED: { tone: 'slate', label: 'Skipped' },
  READY_FOR_CONNECTION: { tone: 'amber', label: 'Ready to connect' },
  CONNECTION_CONFIRMED: { tone: 'indigo', label: 'Sending…' },
  CONNECTION_SENT: { tone: 'green', label: 'Request sent' },
  CONNECTED: { tone: 'green', label: 'Connected' },
  FAILED: { tone: 'red', label: 'Failed' },
};

export const LEAD_STATUS_LABEL = Object.fromEntries(Object.entries(LEAD).map(([k, v]) => [k, v.label])) as Record<LeadStatus, string>;

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const s = LEAD[status] ?? LEAD.NEW;
  return (
    <Badge tone={s.tone} dot pulse={status === 'CONNECTION_CONFIRMED'}>
      {s.label}
    </Badge>
  );
}

export function DegreeBadge({ degree }: { degree: ConnectionDegree }) {
  if (!degree) return <span className="text-xs text-slate-500">—</span>;
  return <Badge tone={degree === '1st' ? 'green' : degree === '2nd' ? 'blue' : 'slate'}>{degree}</Badge>;
}

/** Leads that can still get a connection request from TaskPilot. */
export const canConnect = (s: LeadStatus) => !['CONNECTION_CONFIRMED', 'CONNECTION_SENT', 'CONNECTED'].includes(s);

export const DEFAULT_TEMPLATE = "Hi {firstName}, I came across your profile as {title} at {company} and would be glad to connect.";

export const SAMPLE_LEAD = { name: 'Rahul Sharma', title: 'Technical Recruiter', company: 'ABC Technologies' };

/** Fill {firstName} {name} {title} {company}; drops "at {company}"-style fragments gracefully when empty. */
export function fillTemplate(template: string, lead: { name: string; jobTitle?: string | null; title?: string | null; company?: string | null }): string {
  const first = lead.name.trim().split(/\s+/)[0] ?? '';
  const title = (lead.jobTitle ?? lead.title ?? '').trim();
  const company = (lead.company ?? '').trim();
  return template
    .replace(/\{firstName\}/g, first)
    .replace(/\{name\}/g, lead.name.trim())
    .replace(/\s*\bat\s+\{company\}/g, company ? ` at ${company}` : '')
    .replace(/\{company\}/g, company)
    .replace(/\s*\bas\s+\{title\}/g, title ? ` as ${title}` : '')
    .replace(/\{title\}/g, title)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const DEGREE_LABEL: Record<LeadFinderConfig['connectionDegree'], string> = { all: 'All degrees', '1st': '1st degree', '2nd': '2nd degree', '3rd': '3rd degree' };

/** "Technical Recruiter · India, Delhi · 2nd degree" */
export function searchSummary(c: Partial<LeadFinderConfig> | undefined): string {
  if (!c) return '';
  return [c.keywords, c.locations?.length ? c.locations.join(', ') : null, c.connectionDegree ? DEGREE_LABEL[c.connectionDegree] : null].filter(Boolean).join(' · ');
}

export const ACTION_LABEL: Record<LeadFinderConfig['action'], string> = {
  find_only: 'Find leads only',
  prepare_connection: 'Find leads + prepare connection',
  prepare_with_note: 'Find leads + prepare connection note',
};

export const NOTE_MODE_LABEL: Record<LeadFinderConfig['noteMode'], string> = { none: 'No note', same: 'Same note for all', personalized: 'Personalized draft per lead' };

/** Query string after the hash route: #/platforms/linkedin/drafts?task=abc → { task: 'abc' }. */
export function useHashQuery(): URLSearchParams {
  const read = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [q, setQ] = useState(read);
  useEffect(() => {
    const on = () => setQ(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return q;
}

export const tabHref = (tab: string, query?: Record<string, string>) =>
  `#/platforms/${PLATFORM}/${tab}${query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''}`;

export function leadSubtitle(l: Pick<Lead, 'jobTitle' | 'headline' | 'company'>): string {
  const title = l.jobTitle ?? l.headline ?? '';
  return [title, l.company && !title.toLowerCase().includes(l.company.toLowerCase()) ? l.company : null].filter(Boolean).join(' · ');
}

/** Note textarea with a 300-character counter and placeholder chips (templates) or a live preview. */
export function NoteEditor({
  value,
  onChange,
  template,
  previewLead,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Show placeholder chips and a preview filled with `previewLead`. */
  template?: boolean;
  previewLead?: { name: string; jobTitle?: string | null; title?: string | null; company?: string | null };
  id?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const preview = template ? fillTemplate(value, previewLead ?? SAMPLE_LEAD) : value;
  const over = preview.length > LINKEDIN_NOTE_MAX;
  const insert = (token: string) => {
    const el = ref.current;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        id={id}
        autoFocus={autoFocus}
        rows={4}
        value={value}
        maxLength={template ? 600 : LINKEDIN_NOTE_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={template ? DEFAULT_TEMPLATE : 'Hi Rahul, I’d be glad to connect and learn more about opportunities at ABC Technologies.'}
        className="w-full resize-y rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {template ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Insert:</span>
            {NOTE_PLACEHOLDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insert(p)}
                className="rounded-md bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300 ring-1 ring-inset ring-indigo-400/25 hover:bg-indigo-500/20"
              >
                {p}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <span className={cx('text-xs tabular-nums', over ? 'font-semibold text-rose-300' : 'text-slate-500')}>
          {preview.length}/{LINKEDIN_NOTE_MAX}
          {template ? ' (preview)' : ''}
        </span>
      </div>
      {template && value.trim() && (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs ring-1 ring-inset ring-white/[0.06]">
          <div className="mb-0.5 font-medium text-slate-500">Preview for {(previewLead ?? SAMPLE_LEAD).name}</div>
          <div className="whitespace-pre-wrap text-slate-200">{preview}</div>
        </div>
      )}
    </div>
  );
}
