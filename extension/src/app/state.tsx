/**
 * App-wide state: service connection / pairing, platform descriptors, settings, unread count and
 * the live WebSocket. Pages fetch their own data with useResource and refresh on live messages.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HealthResponse, LiveMessage, PlatformDescriptor, Settings } from '@shared/types/index';
import { api, ApiError, ServiceOfflineError } from '../services/api';
import { live } from '../services/live';
import { storage } from '../services/storage';

export type ConnectionState = 'checking' | 'offline' | 'unpaired' | 'ready';

interface AppState {
  connection: ConnectionState;
  health: HealthResponse | null;
  serviceUrl: string;
  liveConnected: boolean;
  platforms: PlatformDescriptor[];
  platformById: (id: string) => PlatformDescriptor | undefined;
  settings: Settings | null;
  unread: number;
  /** Re-check service + pairing. */
  recheck: () => Promise<void>;
  pair: () => Promise<void>;
  /** Forget the token and pair again. */
  repair: () => Promise<void>;
  setServiceUrl: (url: string) => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  setSettings: (s: Settings) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [serviceUrl, setUrl] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [unread, setUnread] = useState(0);
  const connRef = useRef(connection);
  connRef.current = connection;

  const loadCore = useCallback(async () => {
    const [p, s, n] = await Promise.all([api.platforms(), api.settings(), api.notifications({ unreadOnly: true, limit: 1 })]);
    setPlatforms(p);
    setSettings(s);
    setUnread(n.unread);
  }, []);

  const recheck = useCallback(async () => {
    setUrl(await storage.serviceUrl());
    let h: HealthResponse;
    try {
      h = await api.health();
    } catch {
      setHealth(null);
      setConnection('offline');
      return;
    }
    setHealth(h);
    if (!(await storage.token())) {
      setConnection('unpaired');
      return;
    }
    try {
      await loadCore();
      setConnection('ready');
      void live.start();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await storage.clearToken();
        setConnection('unpaired');
      } else if (err instanceof ServiceOfflineError) setConnection('offline');
      else setConnection('ready');
    }
  }, [loadCore]);

  const pair = useCallback(async () => {
    await api.pair();
    await recheck();
  }, [recheck]);

  const repair = useCallback(async () => {
    live.stop();
    await storage.clearToken();
    await api.pair();
    await recheck();
    live.restart();
  }, [recheck]);

  const setServiceUrl = useCallback(
    async (url: string) => {
      await storage.setServiceUrl(url);
      live.restart();
      await recheck();
    },
    [recheck],
  );

  const refreshSettings = useCallback(async () => setSettings(await api.settings()), []);
  const refreshUnread = useCallback(async () => setUnread((await api.notifications({ unreadOnly: true, limit: 1 })).unread), []);

  useEffect(() => {
    void recheck();
    const offStatus = live.onStatus(setLiveConnected);
    const offMsg = live.subscribe((m) => {
      if (m.type === 'settings:changed') setSettings(m.settings);
      if (m.type === 'notification') setUnread((u) => u + (m.notification.read ? 0 : 1));
    });
    return () => {
      offStatus();
      offMsg();
      live.stop();
    };
  }, [recheck]);

  // Health polling: retry quickly while offline, slowly while connected (keeps the sidebar status honest).
  useEffect(() => {
    const ms = connection === 'offline' || connection === 'checking' ? 5000 : 20_000;
    const t = setInterval(() => {
      if (connRef.current === 'ready') {
        api
          .health()
          .then(setHealth)
          .catch(() => {
            setHealth(null);
            setConnection('offline');
          });
      } else if (connRef.current === 'offline') void recheck();
    }, ms);
    return () => clearInterval(t);
  }, [connection, recheck]);

  const value = useMemo<AppState>(
    () => ({
      connection,
      health,
      serviceUrl,
      liveConnected,
      platforms,
      platformById: (id) => platforms.find((p) => p.id === id),
      settings,
      unread,
      recheck,
      pair,
      repair,
      setServiceUrl,
      refreshSettings,
      refreshUnread,
      setSettings,
    }),
    [connection, health, serviceUrl, liveConnected, platforms, settings, unread, recheck, pair, repair, setServiceUrl, refreshSettings, refreshUnread],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppStateProvider');
  return v;
}

/** Subscribe to live messages for the lifetime of a component. */
export function useLive(handler: (msg: LiveMessage) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => live.subscribe((m) => ref.current(m)), []);
}

/**
 * Fetch data, keep it fresh: reloads when `deps` change and (debounced) when any of the given live
 * message types arrive.
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[], liveTypes: Array<LiveMessage['type']> = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fetchRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (my === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const types = liveTypes.join(',');
  useEffect(() => {
    if (!types) return;
    const wanted = new Set(types.split(','));
    return live.subscribe((m) => {
      if (!wanted.has(m.type)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 350);
    });
  }, [types, reload]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { data, error, loading, reload, setData };
}
