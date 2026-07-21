import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull CYNCO_PORT_OFFSET from `.env.worktree` when Playwright is launched
// outside a moon task (e.g. `pnpm exec playwright test` from the package
// root); the accounts:test-vrt moon task injects it via envFile.
loadWorktreeEnv();

const rawOffset = Number(process.env.CYNCO_PORT_OFFSET ?? 0);
const portOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
// The VRT lane binds its own port two above the registered accountsE2e base
// (4383, see PORT_BASES in scripts/wt.ts) so `moon run accounts:test-e2e
// accounts:test-vrt` can share a pipeline without the two webServers
// colliding. Deriving from the registered base instead of adding a registry
// row keeps wt.ts authoritative: the worktree offset moves both lanes
// together, and +2 mirrors the journals VRT lane at 4285.
const vrtPort = 4385 + portOffset;
const vrtBaseUrl = `http://127.0.0.1:${vrtPort}`;

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  // `*.vrt.ts` is a disjoint pattern from the e2e `*.pw.ts` match, so the
  // two lanes can never accidentally run each other's specs.
  testMatch: ['**/*.vrt.ts'],
  // Per-offset result dirs so concurrent worktrees never clobber each
  // other's diff artifacts; offset 0 keeps a stable primary path.
  outputDir: `/tmp/cynco-accounts-vrt-results${portOffset > 0 ? `-${portOffset}` : ''}`,
  // Baselines are committed per-platform: font rasterization (and thus
  // nearly every pixel of text) differs across OSes, so a darwin baseline
  // can never be compared on linux. The {platform} directory makes the
  // policy visible in the tree and makes a missing-platform failure
  // self-explanatory.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  // moon `script` tasks take no passthrough args (verified: `moonx
  // accounts:test-vrt -- --update-snapshots` never reaches playwright), so
  // intentional baseline refreshes opt in via the environment instead:
  // `VRT_UPDATE_SNAPSHOTS=1 moonx accounts:test-vrt`. `changed` rewrites
  // only genuinely differing baselines, keeping byte-identical files out of
  // the git diff. Default `missing` writes absent baselines and still fails
  // the run — the loud "no baseline for this platform yet" signal.
  updateSnapshots:
    process.env.VRT_UPDATE_SNAPSHOTS === '1' ? 'changed' : 'missing',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  // No retries: captures are deterministic by construction (fixed viewport,
  // reduced motion, settled fonts/rAF). A retry could only hide a
  // nondeterminism bug that must be fixed at the source instead.
  retries: 0,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      // Conservative but nonzero: at these shot sizes (~1M pixels max)
      // 0.001 absorbs a few hundred pixels of sub-pixel AA jitter from
      // Chromium point releases, while real drift (a color, a border, a
      // shifted row) touches thousands of pixels and still fails loudly.
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: vrtBaseUrl,
    headless: true,
    // Determinism contract: fixed logical size, exactly one device pixel
    // per CSS pixel (fractional scaling is the classic screenshot-flake
    // source), and no animation frames racing the capture. colorScheme is
    // deliberately NOT set here — every subject is captured in both
    // schemes, pinned per shot via page.emulateMedia.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // Context-level default only (this playwright version types
    // reducedMotion under contextOptions, not use); every shot re-asserts
    // it through page.emulateMedia in the spec regardless.
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `ACCOUNTS_E2E_PORT=${vrtPort} moon run accounts:test-e2e-server`,
    url: `${vrtBaseUrl}/test/e2e/fixtures/vrt.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});

export default config;
