import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'api-integration', testMatch: '**/api.spec.ts' },
    { name: 'desktop-chromium', testIgnore: '**/api.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', testIgnore: '**/api.spec.ts', use: { ...devices['Pixel 7'] } },
  ],
});
