import { expect, type Page, test } from '@playwright/test';

interface StickyReadout {
  hidden: boolean | null;
  label: string | null;
}

interface LedgerViewLike {
  scrollToSection(account: string, options?: unknown): void;
}

declare global {
  interface Window {
    __ledgerViewScrollReady?: boolean;
    __ledgerView?: LedgerViewLike;
    __ledgerScroller?: HTMLElement;
    __sectionBTop?: number;
    __groupedScroller?: HTMLElement;
    __stickyReadout?: () => StickyReadout;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/ledger-view-scroll.html');
  await page.waitForFunction(() => window.__ledgerViewScrollReady === true);
}

test.describe('ledger view scroll engine against built dist', () => {
  test('smooth scrollToSection visibly animates through intermediate positions', async ({
    page,
  }) => {
    await openFixture(page);

    // Kick off the spring and sample scrollTop over successive frames: the
    // animation must pass THROUGH the range, not teleport.
    const samples = await page.evaluate(async () => {
      const scroller = window.__ledgerScroller!;
      window.__ledgerView!.scrollToSection('Assets:B', {
        behavior: 'smooth',
      });
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      const positions: number[] = [];
      for (let frame = 0; frame < 12; frame += 1) {
        await nextFrame();
        positions.push(scroller.scrollTop);
      }
      return positions;
    });
    const target = await page.evaluate(() => window.__sectionBTop!);
    // Intermediate frames sit strictly between start and target...
    const intermediate = samples.filter((value) => value > 0 && value < target);
    expect(intermediate.length).toBeGreaterThan(2);
    // ...and progress monotonically (critically damped: no overshoot).
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
      expect(samples[index]).toBeLessThanOrEqual(target);
    }
    // The spring settles exactly on the section top.
    await page.waitForFunction(
      (destination) => window.__ledgerScroller!.scrollTop === destination,
      target
    );
  });

  test('user wheel input cancels an in-flight smooth scroll', async ({
    page,
  }) => {
    await openFixture(page);

    const result = await page.evaluate(async () => {
      const scroller = window.__ledgerScroller!;
      window.__ledgerView!.scrollToSection('Assets:B', {
        behavior: 'smooth',
      });
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      // Let the spring get moving, then declare user intent.
      for (let frame = 0; frame < 5; frame += 1) {
        await nextFrame();
      }
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
      const atCancel = scroller.scrollTop;
      // Give a canceled animation plenty of frames to (incorrectly) resume.
      for (let frame = 0; frame < 20; frame += 1) {
        await nextFrame();
      }
      return { atCancel, after: scroller.scrollTop };
    });
    const target = await page.evaluate(() => window.__sectionBTop!);
    expect(result.atCancel).toBeGreaterThan(0);
    expect(result.atCancel).toBeLessThan(target);
    // Position froze where the user took over.
    expect(result.after).toBe(result.atCancel);
  });

  test('sticky group label tracks the period while scrolling a grouped register', async ({
    page,
  }) => {
    await openFixture(page);

    // Hidden at the top: the first group header is fully visible.
    await page.waitForFunction(() => window.__stickyReadout!().hidden === true);

    // Entry rows are 40px (comfortable), group headers 28px, register
    // header 44px: scrollTop 18100 puts a March row (entries 400-599) at
    // the seam below the sticky header.
    await page.evaluate(() => {
      window.__groupedScroller!.scrollTop = 18_100;
    });
    await page.waitForFunction(
      () => window.__stickyReadout!().label === 'March 2026'
    );
    let readout = await page.evaluate(() => window.__stickyReadout!());
    expect(readout.hidden).toBe(false);

    // Deep into June (entry 1100: 28*6 + 1100*40 = 44168 body offset).
    await page.evaluate(() => {
      window.__groupedScroller!.scrollTop = 44_300;
    });
    await page.waitForFunction(
      () => window.__stickyReadout!().label === 'June 2026'
    );

    // Back to the top: the mirror hides instead of doubling the real row.
    await page.evaluate(() => {
      window.__groupedScroller!.scrollTop = 0;
    });
    await page.waitForFunction(() => window.__stickyReadout!().hidden === true);
    readout = await page.evaluate(() => window.__stickyReadout!());
    expect(readout.hidden).toBe(true);
  });
});
