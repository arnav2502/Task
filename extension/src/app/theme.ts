/**
 * Dark / light / system theme. A per-browser display preference, so it lives in localStorage (not in
 * the service). Applied before React renders so the page never flashes the wrong theme.
 */
import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';
const KEY = 'taskpilot-theme';
const listeners = new Set<(m: ThemeMode) => void>();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const resolveTheme = (mode: ThemeMode): 'dark' | 'light' => (mode === 'system' ? (media?.matches ? 'light' : 'dark') : mode);

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  document.documentElement.classList.toggle('light', resolveTheme(mode) === 'light');
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable — still apply for this page */
  }
  applyTheme(mode);
  listeners.forEach((l) => l(mode));
}

/** Follow OS changes while in "system" mode, and keep other open TaskPilot tabs in sync. */
export function initTheme() {
  applyTheme();
  media?.addEventListener('change', () => getThemeMode() === 'system' && applyTheme('system'));
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const mode = getThemeMode();
    applyTheme(mode);
    listeners.forEach((l) => l(mode));
  });
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  useEffect(() => {
    listeners.add(setMode);
    return () => void listeners.delete(setMode);
  }, []);
  return [mode, setThemeMode];
}
