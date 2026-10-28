import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DEFAULT_PORT, PLATFORM_IDS } from '@shared/constants/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file to the repo root (the folder holding .env.example). */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.env.example'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..');
}

export const PROJECT_ROOT = process.env.TASKPILOT_PROJECT_ROOT ?? findProjectRoot(here);
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

export interface AppConfig {
  port: number;
  host: '127.0.0.1';
  dataDir: string;
  logsDir: string;
  /** Pin the Chrome extension that may pair; null = trust the first one. */
  allowedExtensionId: string | null;
  /** Optional AES key (base64, 32 bytes) for the encrypted vault. */
  credentialKey: string | undefined;
  /** Use the encrypted-file vault instead of the OS keychain (tests). */
  forceVault: boolean;
  keyringService: string;
  schedulerTickMs: number;
  /** Per-platform base-URL overrides, used to point adapters at mock sites in tests. */
  platformBaseUrls: Record<string, string>;
}

function resolveDir(value: string | undefined, fallback: string): string {
  return path.resolve(PROJECT_ROOT, value || fallback);
}

/** <PLATFORM>_BASE_URL env vars, e.g. NAUKRI_BASE_URL or CAREER_PORTALS_BASE_URL. */
function platformBaseUrlsFromEnv(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const id of Object.values(PLATFORM_IDS)) {
    const value = process.env[`${id.toUpperCase().replace(/-/g, '_')}_BASE_URL`]?.trim();
    if (value) urls[id] = value.replace(/\/$/, '');
  }
  return urls;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config: AppConfig = {
    port: Number(process.env.PORT) || DEFAULT_PORT,
    host: '127.0.0.1',
    dataDir: resolveDir(process.env.DATA_DIR, 'data'),
    logsDir: resolveDir(process.env.LOGS_DIR, 'logs'),
    allowedExtensionId: process.env.TASKPILOT_EXTENSION_ID?.trim() || null,
    credentialKey: process.env.CREDENTIAL_KEY || undefined,
    forceVault: process.env.CREDENTIAL_BACKEND === 'vault',
    keyringService: process.env.KEYRING_SERVICE || 'taskpilot',
    schedulerTickMs: Number(process.env.SCHEDULER_TICK_MS) || 15_000,
    platformBaseUrls: platformBaseUrlsFromEnv(),
    ...overrides,
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });
  return config;
}
