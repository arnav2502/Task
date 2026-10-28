/**
 * The app's single WebSocket to the service. Reconnects with exponential backoff and fans messages
 * out to subscribers.
 */
import type { LiveMessage } from '@shared/types/index';
import { storage } from './storage';

type Listener = (msg: LiveMessage) => void;
type StatusListener = (connected: boolean) => void;

class LiveConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  connected = false;

  async start() {
    this.stopped = false;
    if (this.ws) return;
    const [base, token] = await Promise.all([storage.serviceUrl(), storage.token()]);
    if (!token || this.stopped) return;
    const url = `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
    };
    ws.onmessage = (e) => {
      let msg: LiveMessage;
      try {
        msg = JSON.parse(String(e.data)) as LiveMessage;
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  /** Reconnect immediately (e.g. after re-pairing or changing the service URL). */
  restart() {
    this.stop();
    void this.start();
  }

  private scheduleReconnect() {
    if (this.stopped || this.timer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.start();
    }, delay);
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    for (const l of this.statusListeners) l(v);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
}

export const live = new LiveConnection();
