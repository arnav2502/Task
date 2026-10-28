import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel } from '@shared/types/index.js';

/** HH:mm:ss in local time. */
export function clock(d = new Date()): string {
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

/** YYYY-MM-DD in local time. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const LEVEL_TAG: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO ', success: 'OK   ', warn: 'WARN ', error: 'ERROR' };

/** Values that must never reach a log, registered while a secret is in memory. */
const redactions = new Set<string>();

/** Register a secret (e.g. a password just read from the keychain) so every logger masks it. */
export function registerSecret(secret: string): () => void {
  if (secret.length < 3) return () => {};
  redactions.add(secret);
  return () => redactions.delete(secret);
}

export function redact(message: string): string {
  let out = message;
  for (const s of redactions) out = out.split(s).join('••••••');
  return out;
}

/** Service-wide logger: console + logs/service.log. */
class AppLogger {
  private file: string | null = null;
  quiet = false;

  init(logsDir: string) {
    fs.mkdirSync(logsDir, { recursive: true });
    this.file = path.join(logsDir, 'service.log');
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 5 * 1024 * 1024) {
        fs.renameSync(this.file, path.join(logsDir, `service-${Date.now()}.log`));
      }
    } catch {
      /* rotation is best effort */
    }
  }

  private write(level: LogLevel, msg: string) {
    const line = `${new Date().toISOString()} ${LEVEL_TAG[level]} ${redact(msg)}`;
    if (!this.quiet) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    if (this.file) {
      try {
        fs.appendFileSync(this.file, `${line}\n`);
      } catch {
        /* disk problems must not crash the service */
      }
    }
  }

  debug(msg: string) {
    if (process.env.LOG_LEVEL === 'debug') this.write('debug', msg);
  }
  info(msg: string) {
    this.write('info', msg);
  }
  warn(msg: string) {
    this.write('warn', msg);
  }
  error(msg: string) {
    this.write('error', msg);
  }
}

export const appLogger = new AppLogger();
