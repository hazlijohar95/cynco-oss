import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull CYNCO_PORT_OFFSET from `.env.worktree` when Playwright is launched
// outside a moon task (e.g. `pnpm exec playwright test` from the package
// root); the journals:test-e2e moon task injects it via envFile.
loadWorktreeEnv();

// Fixed, per-package base port so journals and accounts e2e lanes can run in
// the same moon pipeline without colliding; the worktree offset keeps two
// checkouts of the SAME lane apart (see scripts/wt.ts).
const rawOffset = Number(process.env.CYNCO_PORT_OFFSET ?? 0);
const portOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
const e2ePort = 4283 + portOffset;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
  // Per-offset result dirs so concurrent worktrees never clobber each
  // other's traces; offset 0 keeps the historical path.
  outputDir: `/tmp/cynco-journals-playwright-results${portOffset > 0 ? `-${portOffset}` : ''}`,
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
