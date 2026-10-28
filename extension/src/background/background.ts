/**
 * MV3 background service worker.
 *
 * - Heartbeat every 30 s so the service knows Chrome is open ("Run only while Chrome is open").
 * - Pairs silently once the service is reachable.
 * - Turns new service notifications into Chrome notifications (never replays history).
 * - Keeps the toolbar badge in sync: running jobs, "off" when offline, "!" on errors.
 * - Toolbar click opens (or focuses) the full-tab dashboard.
 * Playwright never runs here — all automation happens in the local service.
 */
import type { NotificationType } from '@shared/types/index';
import { api, ApiError, ServiceOfflineError } from '../services/api';
import { storage } from '../services/storage';

const POLL_ALARM = 'taskpilot-poll';
const APP_URL = chrome.runtime.getURL('index.html');

async function setBadge(text: string, color: string) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

const PRIORITY: Record<NotificationType, 0 | 1 | 2> = { SUCCESS: 0, INFO: 0, WARNING: 1, ERROR: 2, ACTION_REQUIRED: 2 };

async function poll() {
  try {
    if (!(await storage.token())) {
      await api.health();
      await api.pair();
    }
    const hb = await api.heartbeat();
    const last = await storage.lastNotificationId();
    if (last === null) {
      // First run: start from "now" — never replay history as pop-ups.
      await storage.setLastNotificationId(hb.latestNotificationId);
    } else if (hb.latestNotificationId > last) {
      const { notifications } = await api.notifications({ after: last, limit: 20 });
      let max = last;
      for (const n of notifications.sort((a, b) => a.id - b.id)) {
        max = Math.max(max, n.id);
        // id = tp|<notificationId>|<runId>|<link>  — the click handler opens the link (e.g. a review screen) or the run.
        chrome.notifications.create(`tp|${n.id}|${encodeURIComponent(n.runId ?? '')}|${encodeURIComponent(n.link ?? '')}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
          title: n.title,
          message: n.message,
          priority: PRIORITY[n.type],
          requireInteraction: n.type === 'ACTION_REQUIRED',
        });
      }
      await storage.setLastNotificationId(Math.max(max, hb.latestNotificationId));
    }
    await setBadge(hb.active > 0 ? String(hb.active) : '', '#6366F1');
  } catch (err) {
    if (err instanceof ServiceOfflineError) await setBadge('off', '#64748B');
    else if (err instanceof ApiError && err.status === 401) {
      // Token no longer valid (service data reset) — re-pair on the next tick.
      await storage.clearToken();
      await setBadge('!', '#E11D48');
    } else await setBadge('!', '#E11D48');
  }
}

async function openApp(hash = '#/dashboard') {
  const tabs = await chrome.tabs.query({ url: `${APP_URL}*` });
  const existing = tabs[0];
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url: `${APP_URL}${hash}` });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${APP_URL}${hash}` });
  }
}

function ensureAlarm() {
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void poll();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void poll();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void poll();
});
chrome.action.onClicked.addListener(() => void openApp());
chrome.notifications.onClicked.addListener((id) => {
  const [, , rawRun = '', rawLink = ''] = id.split('|');
  const runId = decodeURIComponent(rawRun);
  const link = decodeURIComponent(rawLink);
  void openApp(link.startsWith('#/') ? link : runId ? `#/history/${encodeURIComponent(runId)}` : '#/notifications');
  chrome.notifications.clear(id);
});
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'poll-now') {
    void poll().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
