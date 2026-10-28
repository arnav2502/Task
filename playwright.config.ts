import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: the real Naukri adapter, executor, queue and API driving a real Chromium against
 * the local mock Naukri site in tests/mock — never the live naukri.com.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  reporter: [['list']],
  timeout: 180_000,
  fullyParallel: false,
  workers: process.env.CI ? 1 : 3,
});
