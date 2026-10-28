/** Minimal hash router: #/section/param. No routing library. */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'platforms' }
  | { name: 'platform'; id: string; tab?: string }
  | { name: 'accounts' }
  | { name: 'tasks' }
  | { name: 'schedules' }
  | { name: 'history'; runId?: string }
  | { name: 'notifications' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  const [section, a, b] = parts;
  switch (section) {
    case 'platforms':
      return a ? { name: 'platform', id: a, tab: b } : { name: 'platforms' };
    case 'accounts':
    case 'tasks':
    case 'schedules':
    case 'notifications':
    case 'settings':
      return { name: section };
    case 'history':
      return a ? { name: 'history', runId: a } : { name: 'history' };
    default:
      return { name: 'dashboard' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'platform':
      return `#/platforms/${encodeURIComponent(route.id)}${route.tab ? `/${encodeURIComponent(route.tab)}` : ''}`;
    case 'history':
      return route.runId ? `#/history/${encodeURIComponent(route.runId)}` : '#/history';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const h = href(route);
  if (opts.replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (opts.replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
