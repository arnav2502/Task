import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit + service-level tests (no real browser). Browser flows live in tests/e2e (Playwright Test). */
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared') } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // better-sqlite3 is a native module: run each file in its own process.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
