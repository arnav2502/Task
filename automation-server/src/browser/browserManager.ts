import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { BrowserMode } from '@shared/types/index.js';
import { AutomationError, toAutomationError } from '../errors/automationError.js';
import { canHideWindows, showBrowserWindows, startHideWatcher } from './windowControl.js';

const VIEWPORT = { width: 1366, height: 900 };

/**
 * One account's browser for the duration of a run. The browser launches lazily on the first
 * `page()` call, so a task can fail fast (e.g. "no resume in folder") without opening anything,
 * and adapters that never need a browser never launch one.
 */
export interface AutomationSession {
  readonly accountId: string;
  readonly mode: BrowserMode;
  readonly profileDir: string;
  readonly isOpen: boolean;
  page(): Promise<Page>;
  /** Bring a hidden (background) window on screen, e.g. so the user can type an OTP. */
  revealWindow(): Promise<void>;
  screenshot(file: string): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Turn off Chromium's password manager for an account profile: no "Save password?" bubble (it would
 * pop up a window even in background mode) and no second copy of the password in the profile.
 */
export function disablePasswordManager(profileDir: string) {
  const prefsFile = path.join(profileDir, 'Default', 'Preferences');
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8')) as Record<string, unknown>;
  } catch {
    /* new profile */
  }
  const profile = (prefs.profile as Record<string, unknown> | undefined) ?? {};
  if (prefs.credentials_enable_service === false && profile.password_manager_enabled === false) return;
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  prefs.profile = { ...profile, password_manager_enabled: false };
  fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
  fs.writeFileSync(prefsFile, JSON.stringify(prefs));
}

class PersistentSession implements AutomationSession {
  private context: BrowserContext | null = null;
  private current: Page | null = null;
  private launching: Promise<Page> | null = null;
  private stopHider: (() => void) | null = null;
  private closed = false;

  constructor(
    readonly accountId: string,
    readonly mode: BrowserMode,
    readonly profileDir: string,
    private readonly onClose: (s: PersistentSession) => void,
  ) {}

  get isOpen() {
    return this.context !== null;
  }

  page(): Promise<Page> {
    if (this.closed) return Promise.reject(new AutomationError('CANCELLED', 'The browser session was closed'));
    if (this.current && !this.current.isClosed()) return Promise.resolve(this.current);
    this.launching ??= this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async launch(): Promise<Page> {
    fs.mkdirSync(this.profileDir, { recursive: true });
    disablePasswordManager(this.profileDir);
    // Background on Windows: the hider is already scanning before the browser opens a window.
    this.stopHider = this.mode === 'background' && canHideWindows ? await startHideWatcher(this.profileDir) : null;
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: this.mode === 'headless',
        viewport: VIEWPORT,
        locale: 'en-IN',
        acceptDownloads: false,
        // Background: off-screen at launch (no flash), then hidden from desktop + taskbar (Windows); minimized elsewhere.
        args: this.mode === 'background' ? (canHideWindows ? ['--window-position=-32000,-32000'] : ['--start-minimized']) : [],
      });
    } catch (err) {
      this.stopHider?.();
      this.stopHider = null;
      throw toAutomationError(err);
    }
    if (this.closed) {
      // close() ran while Chromium was starting: shut it down now so the profile is not left locked.
      const ctx = this.context;
      this.context = null;
      this.stopHider?.();
      await ctx.close().catch(() => {});
      throw new AutomationError('CANCELLED', 'The browser session was closed while starting');
    }
    this.context.setDefaultTimeout(20_000);
    this.context.setDefaultNavigationTimeout(45_000);
    this.context.on('close', () => this.stopHider?.());
    const page = this.context.pages()[0] ?? (await this.context.newPage());
    for (const p of this.context.pages()) if (p !== page) await p.close().catch(() => {});
    this.current = page;
    return page;
  }

  async revealWindow(): Promise<void> {
    const page = this.current;
    if (!page || this.mode === 'headless') return;
    try {
      this.stopHider?.();
      this.stopHider = null;
      await showBrowserWindows(this.profileDir);
      const cdp = await page.context().newCDPSession(page);
      const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 60, width: VIEWPORT.width, height: VIEWPORT.height } });
      await page.bringToFront();
    } catch {
      /* best effort */
    }
  }

  async screenshot(file: string): Promise<boolean> {
    if (!this.current || this.current.isClosed()) return false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await this.current.screenshot({ path: file, fullPage: false, timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const ctx = this.context;
    this.context = null;
    this.current = null;
    this.stopHider?.();
    this.stopHider = null;
    this.onClose(this);
    await ctx?.close().catch(() => {});
  }
}

/**
 * Owns every open account browser. Each account has an isolated persistent profile
 * (data/accounts/<platform>/<accountId>/browser-profile), so cookies and sessions never mix.
 */
export class BrowserManager {
  private readonly open = new Set<PersistentSession>();

  createSession(accountId: string, profileDir: string, mode: BrowserMode): AutomationSession {
    const s = new PersistentSession(accountId, mode, profileDir, (closed) => this.open.delete(closed));
    this.open.add(s);
    return s;
  }

  get openCount() {
    return [...this.open].filter((s) => s.isOpen).length;
  }

  async closeAll() {
    await Promise.all([...this.open].map((s) => s.close()));
  }
}
