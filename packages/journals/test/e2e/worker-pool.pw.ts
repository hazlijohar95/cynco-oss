import { expect, type Page, test } from '@playwright/test';

interface FixtureWorkerStats {
  managerState: 'waiting' | 'initializing' | 'initialized';
  totalWorkers: number;
  workersFailed: boolean;
}

declare global {
  interface Window {
    __workerPoolReady?: boolean;
    __pooledMatchesSync?: boolean;
    __pooledLength?: number;
    __stats?: FixtureWorkerStats;
    __registerWindowMatchesSync?: () => boolean;
    __brokenMatchesSync?: boolean;
    __brokenStats?: () => FixtureWorkerStats;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/worker-pool.html');
  // The fixture awaits pool initialization, both render paths, and the
  // broken-pool fallback before raising the flag.
  await page.waitForFunction(() => window.__workerPoolReady === true, null, {
    timeout: 15_000,
  });
}

test.describe('worker pool with a REAL module worker', () => {
  test('pooled register window HTML equals the sync render', async ({
    page,
  }) => {
    await openFixture(page);

    const result = await page.evaluate(() => ({
      matches: window.__pooledMatchesSync,
      length: window.__pooledLength,
    }));
    // Byte-identical output, and non-trivially so (120 rendered rows).
    expect(result.matches).toBe(true);
    expect(result.length).toBeGreaterThan(1000);
  });

  test('pool stats report at least one live worker', async ({ page }) => {
    await openFixture(page);

    const stats = await page.evaluate(() => window.__stats!);
    expect(stats.managerState).toBe('initialized');
    expect(stats.workersFailed).toBe(false);
    expect(stats.totalWorkers).toBeGreaterThanOrEqual(1);
  });

  test('a pool-driven Register commits the identical window HTML', async ({
    page,
  }) => {
    await openFixture(page);

    // The worker commit lands on an animation frame after the response;
    // waitForFunction polls until the committed innerHTML matches the sync
    // renderer for the same range.
    await page.waitForFunction(
      () => window.__registerWindowMatchesSync!() === true
    );
  });

  test('a broken worker URL falls back to the main thread with identical output', async ({
    page,
  }) => {
    await openFixture(page);

    expect(await page.evaluate(() => window.__brokenMatchesSync)).toBe(true);
    const stats = await page.evaluate(() => window.__brokenStats!());
    expect(stats.workersFailed).toBe(true);
  });
});
