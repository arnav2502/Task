/**
 * chrome.storage.local wrapper. Only the service URL, the pairing token and the last seen
 * notification id are stored here — never credentials.
 */
import { DEFAULT_SERVICE_URL } from '@shared/constants/index';

interface StoredState {
  serviceUrl?: string;
  token?: string;
  lastNotificationId?: number;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

async function read(): Promise<StoredState> {
  if (!hasChromeStorage()) {
    try {
      return JSON.parse(localStorage.getItem('taskpilot') ?? '{}') as StoredState;
    } catch {
      return {};
    }
  }
  return (await chrome.storage.local.get(['serviceUrl', 'token', 'lastNotificationId'])) as StoredState;
}

async function write(patch: Partial<StoredState>): Promise<void> {
  if (!hasChromeStorage()) {
    // Dev fallback when the UI is opened outside the extension (vite preview).
    localStorage.setItem('taskpilot', JSON.stringify({ ...(await read()), ...patch }));
    return;
  }
  await chrome.storage.local.set(patch);
}

async function remove(keys: Array<keyof StoredState>): Promise<void> {
  if (!hasChromeStorage()) {
    const s = await read();
    for (const k of keys) delete s[k];
    localStorage.setItem('taskpilot', JSON.stringify(s));
    return;
  }
  await chrome.storage.local.remove(keys);
}

export const storage = {
  async serviceUrl(): Promise<string> {
    return ((await read()).serviceUrl || DEFAULT_SERVICE_URL).replace(/\/+$/, '');
  },
  setServiceUrl: (url: string) => write({ serviceUrl: url.trim().replace(/\/+$/, '') }),
  async token(): Promise<string | null> {
    return (await read()).token ?? null;
  },
  setToken: (token: string) => write({ token }),
  clearToken: () => remove(['token']),
  async lastNotificationId(): Promise<number | null> {
    const v = (await read()).lastNotificationId;
    return typeof v === 'number' ? v : null;
  },
  setLastNotificationId: (id: number) => write({ lastNotificationId: id }),
};
