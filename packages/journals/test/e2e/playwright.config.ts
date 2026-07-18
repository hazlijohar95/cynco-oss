import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';

// Fixed, per-package port so journals and accounts e2e lanes can run in the
// same moon pipeline without colliding.
const e2ePort = 4283;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
  outputDir: '/tmp/cynco-journals-playwright-results',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  // One retry absorbs the rare rAF/window-commit race under parallel worker
  // pressure while keeping genuinely broken suites loud.
  retries: 1,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
  webServer: {
    command: `JOURNALS_E2E_PORT=${e2ePort} moon run journals:test-e2e-server`,
    url: `${e2eBaseUrl}/test/e2e/fixtures/register-style-isolation.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

export default config;
