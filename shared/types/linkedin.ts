/**
 * LinkedIn module types (Lead Finder + user-confirmed connection assistant). Used by the LinkedIn
 * adapter's routes (/platforms/linkedin/...) and the LinkedIn UI. Generic code never imports this file.
 *
 * Design rule: TaskPilot finds and prepares; a person decides. A connection request is only ever sent
 * from an explicit per-lead "Confirm & Send" action — never by the scheduler, never in bulk.
 */

export const LINKEDIN_TASKS = {
  LEAD_FINDER: 'LEAD_FINDER',
} as const;

/** Account-level actions the LinkedIn adapter performs only on explicit user confirmation. */
export const LINKEDIN_ACTIONS = {
  SEND_CONNECTION: 'SEND_CONNECTION',
} as const;

export const LEAD_STATUSES = [
  'NEW',
  'REVIEWED',
  'SELECTED',
  'SKIPPED',
  'READY_FOR_CONNECTION',
  'CONNECTION_CONFIRMED',
  'CONNECTION_SENT',
  'CONNECTED',
  'FAILED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type ConnectionDegreeFilter = 'all' | '1st' | '2nd' | '3rd';
export type ConnectionDegree = '1st' | '2nd' | '3rd' | null;

/**
 * What a Lead Finder run prepares:
 * - find_only: discover and store leads
 * - prepare_connection: also queue matching leads for review (no note)
 * - prepare_with_note: also prepare a connection note (same for all, or a per-lead draft)
 */
export type LeadAction = 'find_only' | 'prepare_connection' | 'prepare_with_note';
export type NoteMode = 'none' | 'same' | 'personalized';

/** LinkedIn's limit for an invitation note. */
export const LINKEDIN_NOTE_MAX = 300;

/** Placeholders available in a personalized note template. */
export const NOTE_PLACEHOLDERS = ['{firstName}', '{name}', '{title}', '{company}'] as const;

export interface LeadFinderConfig {
  /** Main search query, e.g. "Technical Recruiter". */
  keywords: string;
  /** A lead matches if its headline contains any of these (empty = no title filter). */
  jobTitles: string[];
  /** A lead matches if its location contains any of these (empty = anywhere). */
  locations: string[];
  /** Company names (current or past) — sent to LinkedIn's company keyword field and matched on the card. */
  companies: string[];
  /** Optional current company that must appear in the lead's headline. */
  currentCompany: string;
  /** Optional industry, added to the search keywords (LinkedIn's industry filter needs internal ids). */
  industry: string;
  schools: string[];
  /** Words that must appear in the headline (any of them). */
  profileKeywords: string[];
  connectionDegree: ConnectionDegreeFilter;
  action: LeadAction;
  noteMode: NoteMode;
  /** The note (same for all) or the template for personalized drafts, e.g. "Hi {firstName}, …". */
  note: string;
  /** Result cards read per run (kept small on purpose — this is not a scraper). */
  maxLeads: number;
  /** Connection candidates prepared per run. */
  maxCandidates: number;
}

export interface Lead {
  id: number;
  accountId: string;
  /** Task that last discovered this lead. */
  taskId: string | null;
  /** Stable key: the profile path, e.g. "/in/rahul-sharma-123". */
  profileReference: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  connectionDegree: ConnectionDegree;
  status: LeadStatus;
  lastError: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DraftStatus = 'pending' | 'confirmed' | 'sent' | 'skipped' | 'failed';

export interface ConnectionDraft {
  id: number;
  leadId: number;
  taskId: string | null;
  /** null = send without a note. */
  note: string | null;
  status: DraftStatus;
  /** Run that sends it, once confirmed. */
  runId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  lead: Lead;
}

export interface LinkedInSearch {
  id: number;
  taskId: string;
  runId: string | null;
  keywords: string;
  location: string | null;
  company: string | null;
  jobTitles: string[];
  industry: string | null;
  connectionDegree: ConnectionDegreeFilter;
  filters: Record<string, unknown>;
  /** Cards read / leads matching the filters / new leads / connection candidates prepared. */
  resultsRead: number;
  matched: number;
  newLeads: number;
  candidates: number;
  createdAt: string;
}

export interface LinkedInStats {
  leadsFound: number;
  leadsToday: number;
  reviewed: number;
  selected: number;
  pendingReview: number;
  connectionsSent: number;
  connected: number;
  skipped: number;
  failed: number;
}

/** Per-task LinkedIn numbers, joined with the generic Task in the UI. */
export interface LinkedInTaskStats {
  taskId: string;
  leadsFound: number;
  pendingReview: number;
  connectionsSent: number;
  lastSearch: LinkedInSearch | null;
}

export interface LeadListResponse {
  leads: Lead[];
  total: number;
}

export interface ConfirmConnectionInput {
  /** null / omitted = send without a note. */
  note?: string | null;
  /** Must be true: the request is sent only because a person pressed "Confirm & Send". */
  confirm: true;
}
