import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';

// Fixed, per-package port so journals and accounts e2e lanes can run in the
// same moon pipeline without colliding.
const e2ePort = 4383;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
  outputDir: '/tmp/cynco-accounts-playwright-results',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  // One retry absorbs the rare HTML5-drag flake when mousemove events race
  // the browser's dragover handoff under parallel worker pressure.
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
    command: `ACCOUNTS_E2E_PORT=${e2ePort} moon run accounts:test-e2e-server`,
    url: `${e2eBaseUrl}/test/e2e/fixtures/tree-style-isolation.html`,
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
