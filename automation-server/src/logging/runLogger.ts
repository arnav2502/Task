import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel, RunLogLine, RunStage } from '@shared/types/index.js';
import { LEVEL_TAG, appLogger, clock, localDate, redact } from './logger.js';

export interface RunLogSink {
  append(runId: string, level: LogLevel, stage: RunStage | null, message: string, ts: string): RunLogLine;
}

/**
 * Structured, timestamped logger for one execution run. Every line goes to
 *   1. the database (Run Details),
 *   2. a plain-text file logs/YYYY-MM-DD/<platform>/<accountId>/<taskType>/<runId>.log,
 *   3. the live WebSocket stream.
 * Registered secrets are masked before anything is written.
 */
export class RunLogger {
  readonly logPath: string;
  private stage: RunStage | null = null;

  constructor(
    readonly runId: string,
    readonly dir: string,
    private readonly sink: RunLogSink,
    private readonly onLine: (line: RunLogLine) => void,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, `${runId}.log`);
  }

  setStage(stage: RunStage) {
    this.stage = stage;
  }

  get currentStage(): RunStage | null {
    return this.stage;
  }

  log(level: LogLevel, message: string) {
    const now = new Date();
    const safe = redact(message);
    const line = this.sink.append(this.runId, level, this.stage, safe, now.toISOString());
    try {
      fs.appendFileSync(this.logPath, `[${localDate(now)} ${clock(now)}] ${LEVEL_TAG[level]} ${this.stage ? `[${this.stage}] ` : ''}${safe}\n`);
    } catch {
      /* a full disk must not fail the run */
    }
    this.onLine(line);
    appLogger.debug(`[${this.runId}] ${safe}`);
  }

  info(m: string) {
    this.log('info', m);
  }
  success(m: string) {
    this.log('success', m);
  }
  warn(m: string) {
    this.log('warn', m);
  }
  error(m: string) {
    this.log('error', m);
  }
  debug(m: string) {
    this.log('debug', m);
  }

  /** Raw line in the file only (RUN STARTED / RESULT banners). */
  banner(m: string) {
    try {
      fs.appendFileSync(this.logPath, `${redact(m)}\n`);
    } catch {
      /* ignore */
    }
  }
}
