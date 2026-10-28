/**
 * Typed client for the local TaskPilot service (docs/API.md). The extension is only a control panel:
 * every action is a call to the service, which owns Playwright, the scheduler and the queue.
 */
import type {
  Account,
  AccountSummary,
  ActivityEvent,
  AppNotification,
  BrowserMode,
  DashboardData,
  ExecutionRun,
  HealthResponse,
  PlatformActivity,
  PlatformDescriptor,
  QueueSnapshot,
  RunDetails,
  RunFilters,
  RunPage,
  Schedule,
  ScheduleFrequency,
  ScheduleMode,
  Settings,
  Task,
  ValidationCheck,
} from '@shared/types/index';
import type { ResumeFolderScan, SharedJobsResponse } from '@shared/types/naukri';
import type {
  ConnectionDraft,
  DraftStatus,
  Lead,
  LeadListResponse,
  LeadStatus,
  LinkedInSearch,
  LinkedInStats,
  LinkedInTaskStats,
} from '@shared/types/linkedin';
import { storage } from './storage';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The service could not be reached at all (not running, wrong URL). */
export class ServiceOfflineError extends Error {
  constructor(message = 'TaskPilot service is not reachable') {
    super(message);
    this.name = 'ServiceOfflineError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function raw(method: string, path: string, body?: unknown, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<Response> {
  const base = await storage.serviceUrl();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = await storage.token();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
  } catch {
    throw new ServiceOfflineError();
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      if (j.error) message = j.error;
      code = j.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, code);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { auth?: boolean; timeoutMs?: number }): Promise<T> {
  const res = await raw(method, path, body, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string, q?: Query) => request<T>('GET', `${path}${qs(q)}`);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T = void>(path: string) => request<T>('DELETE', path);
const enc = encodeURIComponent;

export interface AccountInput {
  platformId: string;
  name: string;
  username: string;
  password?: string;
  enabled?: boolean;
  modeOverride?: BrowserMode | null;
}

export interface ScheduleInput {
  taskId: string;
  frequency: ScheduleFrequency;
  time: string;
  daysOfWeek?: number[];
  onceDate?: string | null;
  windowEnd?: string | null;
  randomMinute?: boolean;
  mode?: ScheduleMode;
  enabled?: boolean;
}

export const api = {
  // ---- pairing / system
  health: () => request<HealthResponse>('GET', '/health', undefined, { auth: false, timeoutMs: 5000 }),
  async pair(): Promise<string> {
    const { token } = await request<{ token: string }>('POST', '/pair', {}, { auth: false });
    await storage.setToken(token);
    return token;
  },
  heartbeat: () =>
    request<{ ok: boolean; active: number; unreadNotifications: number; latestNotificationId: number }>('POST', '/heartbeat', {}, { timeoutMs: 8000 }),
  dashboard: () => get<DashboardData>('/dashboard'),
  queue: () => get<QueueSnapshot>('/queue'),
  settings: () => get<Settings>('/settings'),
  saveSettings: (patch: Partial<Settings>) => put<Settings>('/settings', patch),
  events: (limit = 50) => get<ActivityEvent[]>('/events', { limit }),
  pickFolder: (initial?: string) => request<{ path: string | null }>('POST', '/system/pick-folder', { initial }, { timeoutMs: 10 * 60_000 }),

  // ---- platforms
  platforms: () => get<PlatformDescriptor[]>('/platforms'),
  platform: (id: string) => get<PlatformDescriptor & { activity: PlatformActivity }>(`/platforms/${enc(id)}`),
  platformTaskConfig: (platformId: string, taskType: string) =>
    get<{ configuration: Record<string, unknown> }>(`/platforms/${enc(platformId)}/tasks/${enc(taskType)}/config`),
  savePlatformTaskConfig: (platformId: string, taskType: string, configuration: Record<string, unknown>) =>
    put<{ configuration: Record<string, unknown> }>(`/platforms/${enc(platformId)}/tasks/${enc(taskType)}/config`, { configuration }),

  // ---- accounts
  accounts: (platformId?: string) => get<AccountSummary[]>('/accounts', { platformId }),
  account: (id: string) => get<AccountSummary>(`/accounts/${enc(id)}`),
  createAccount: (input: AccountInput) => post<Account>('/accounts', input),
  updateAccount: (id: string, patch: Partial<Omit<AccountInput, 'platformId'>>) => put<Account>(`/accounts/${enc(id)}`, patch),
  deleteAccount: (id: string) => del(`/accounts/${enc(id)}`),
  connect: (id: string) => post<ExecutionRun>(`/accounts/${enc(id)}/connect`),
  testLogin: (id: string, mode?: ScheduleMode) => post<ExecutionRun>(`/accounts/${enc(id)}/test-login`, mode ? { mode } : {}),
  disconnect: (id: string) => post<Account>(`/accounts/${enc(id)}/disconnect`),
  validate: (id: string) => request<ValidationCheck[]>('POST', `/accounts/${enc(id)}/validate`, {}, { timeoutMs: 3 * 60_000 }),

  // ---- tasks
  tasks: (q: { platformId?: string; accountId?: string } = {}) => get<Task[]>('/tasks', q),
  task: (id: string) => get<Task>(`/tasks/${enc(id)}`),
  updateTask: (id: string, patch: { name?: string; enabled?: boolean; configuration?: Record<string, unknown>; resetConfiguration?: boolean }) =>
    put<Task>(`/tasks/${enc(id)}`, patch),
  /** Create a named instance of a multi-instance task type (e.g. a LinkedIn lead search). */
  createTask: (input: { accountId: string; taskType: string; name: string; configuration?: Record<string, unknown>; enabled?: boolean }) =>
    post<Task>('/tasks', input),
  renameTask: (id: string, name: string) => put<Task>(`/tasks/${enc(id)}`, { name }),
  /** Delete a multi-instance task (its schedules go with it). */
  deleteTask: (id: string) => del(`/tasks/${enc(id)}`),
  runTask: (id: string, mode?: ScheduleMode) => post<ExecutionRun>(`/tasks/${enc(id)}/run`, mode ? { mode } : {}),

  // ---- schedules
  schedules: (q: { platformId?: string; accountId?: string; taskId?: string } = {}) => get<Schedule[]>('/schedules', q),
  createSchedule: (input: ScheduleInput) => post<Schedule>('/schedules', input),
  updateSchedule: (id: string, patch: Partial<Omit<ScheduleInput, 'taskId'>>) => put<Schedule>(`/schedules/${enc(id)}`, patch),
  deleteSchedule: (id: string) => del(`/schedules/${enc(id)}`),

  // ---- runs
  runs: (f: RunFilters = {}) => get<RunPage>('/runs', f as Query),
  run: (id: string) => get<RunDetails>(`/runs/${enc(id)}`),
  cancelRun: (id: string) => post<{ cancelled: boolean }>(`/runs/${enc(id)}/cancel`),
  retryRun: (id: string) => post<ExecutionRun>(`/runs/${enc(id)}/retry`),
  async screenshotUrl(id: string): Promise<string> {
    const res = await raw('GET', `/runs/${enc(id)}/screenshot`);
    return URL.createObjectURL(await res.blob());
  },
  async runLogText(id: string): Promise<string> {
    return (await raw('GET', `/runs/${enc(id)}/log`)).text();
  },

  // ---- notifications
  notifications: (q: { unreadOnly?: boolean; after?: number; limit?: number } = {}) =>
    get<{ notifications: AppNotification[]; unread: number; latestId: number }>('/notifications', q),
  markRead: (body: { ids?: number[]; all?: boolean }) => post<{ unread: number }>('/notifications/read', body),
  clearNotifications: () => del('/notifications'),

  // ---- LinkedIn module (docs/LINKEDIN.md). Sending a connection request is always an explicit, single-lead action.
  linkedin: {
    stats: (accountId?: string) => get<LinkedInStats>('/platforms/linkedin/stats', { accountId }),
    taskStats: () => get<LinkedInTaskStats[]>('/platforms/linkedin/tasks'),
    taskDetail: (taskId: string) => get<LinkedInTaskStats & { searches: LinkedInSearch[] }>(`/platforms/linkedin/tasks/${enc(taskId)}`),
    searches: (q: { taskId?: string; limit?: number } = {}) => get<LinkedInSearch[]>('/platforms/linkedin/searches', q),
    leads: (q: { status?: LeadStatus; taskId?: string; accountId?: string; q?: string; limit?: number; offset?: number } = {}) =>
      get<LeadListResponse>('/platforms/linkedin/leads', q),
    lead: (id: number) =>
      get<Lead & { draft: ConnectionDraft | null; actions: Array<{ action: string; detail: string | null; runId: string | null; createdAt: string }> }>(
        `/platforms/linkedin/leads/${id}`,
      ),
    review: (id: number) => post<Lead>(`/platforms/linkedin/leads/${id}/review`),
    select: (id: number) => post<Lead>(`/platforms/linkedin/leads/${id}/select`),
    skip: (id: number) => post<Lead>(`/platforms/linkedin/leads/${id}/skip`),
    /** Bulk review / select / skip. There is deliberately no bulk send. */
    bulk: (ids: number[], action: 'review' | 'select' | 'skip') => post<{ updated: number }>('/platforms/linkedin/leads/bulk', { ids, action }),
    saveDraft: (id: number, note: string | null) => post<ConnectionDraft>(`/platforms/linkedin/leads/${id}/connection-draft`, { note }),
    /** Sends ONE connection request, only because the user pressed "Send Connection Request". */
    confirmConnection: (id: number, note: string | null) =>
      post<ExecutionRun>(`/platforms/linkedin/leads/${id}/confirm-connection`, { confirm: true, note }),
    drafts: (q: { status?: DraftStatus; taskId?: string } = {}) => get<ConnectionDraft[]>('/platforms/linkedin/connection-drafts', q),
  },

  // ---- Naukri module
  naukri: {
    scanFor: (accountId?: string) => get<ResumeFolderScan>('/platforms/naukri/resume/scan', { accountId }),
    previewScan: (body: { folderPath: string; selectionMode: 'latest' | 'specific'; specificFile?: string }) =>
      post<ResumeFolderScan>('/platforms/naukri/resume/scan', body),
    sharedJobs: (q: { accountId?: string; limit?: number } = {}) => get<SharedJobsResponse>('/platforms/naukri/shared-jobs', q),
    resetBaseline: (accountId: string) => post<void>(`/platforms/naukri/accounts/${enc(accountId)}/reset-baseline`),
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof ServiceOfflineError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
