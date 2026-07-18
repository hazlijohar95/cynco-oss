import { expect, type Page, test } from '@playwright/test';

interface StreamSample {
  count: number;
  done: boolean;
}

declare global {
  interface Window {
    __entryStreamReady?: boolean;
    __start?: (options?: { delayMs?: number }) => void;
    __doneCount?: number | null;
    __samples?: StreamSample[];
    __scroller?: HTMLElement;
  }
}

const TOTAL = 30;

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/entry-stream.html');
  await page.waitForFunction(() => window.__entryStreamReady === true);
}

function entryCount(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__scroller?.querySelectorAll('[data-entry]').length ?? 0
  );
}

test.describe('entry stream over a real timed source', () => {
  test('entries appear over time and the footer reaches done', async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() => window.__start!());

    const footerCount = page.locator('journals-container [data-stream-count]');
    const footerState = page.locator('journals-container [data-stream-state]');
    await expect(footerCount).toHaveText(String(TOTAL));
    await expect(footerState).toHaveText('done');
    await expect(footerState).toHaveAttribute('data-stream-done', 'true');
    expect(await entryCount(page)).toBe(TOTAL);
    expect(await page.evaluate(() => window.__doneCount)).toBe(TOTAL);

    // The in-page rAF sampler proves progressive arrival: frames existed
    // where some — but not all — entries were rendered and the stream was
    // still open. Driver-side polling could miss the ~300ms stream entirely.
    const samples = await page.evaluate(() => window.__samples!);
    expect(
      samples.some(
        (sample) => sample.count > 0 && sample.count < TOTAL && !sample.done
      )
    ).toBe(true);
    // Rendered counts only ever grow.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].count).toBeGreaterThanOrEqual(
        samples[index - 1].count
      );
    }
  });

  test('autoscroll keeps the last entry in view through the stream', async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() => window.__start!());

    await page.waitForFunction(() => window.__doneCount === 30);

    // The scroller must have actually overflowed (otherwise autoscroll is
    // untested) and be pinned to the bottom, with the last entry inside the
    // viewport.
    const state = await page.evaluate(() => {
      const scroller = window.__scroller!;
      const viewport = scroller.getBoundingClientRect();
      const entries = scroller.querySelectorAll('[data-entry]');
      const last = entries[entries.length - 1].getBoundingClientRect();
      return {
        overflowed: scroller.scrollHeight > viewport.height + 100,
        atBottom:
          scroller.scrollTop + viewport.height >= scroller.scrollHeight - 1,
        lastVisible: last.top < viewport.bottom && last.bottom > viewport.top,
      };
    });
    expect(state.overflowed).toBe(true);
    expect(state.atBottom).toBe(true);
    expect(state.lastVisible).toBe(true);
  });

  test('scrolling up mid-stream releases the follow lock', async ({ page }) => {
    await openFixture(page);
    // Wider cadence (40ms x 30 entries): the driver round trips for the
    // mid-stream scroll are comfortably inside the stream's lifetime.
    await page.evaluate(() => window.__start!({ delayMs: 40 }));

    // Wait until the content already overflows the 300px viewport so a
    // scroll-up is meaningful, while the stream is still producing.
    await page.waitForFunction(() => {
      const scroller = window.__scroller;
      if (scroller == null) {
        return false;
      }
      const count = scroller.querySelectorAll('[data-entry]').length;
      return (
        count >= 8 &&
        count < 25 &&
        scroller.scrollHeight > scroller.getBoundingClientRect().height * 2
      );
    });

    const countAtScrollUp = await page.evaluate(() => {
      const scroller = window.__scroller!;
      scroller.scrollTop = 0;
      return scroller.querySelectorAll('[data-entry]').length;
    });
    // Guard: the scroll genuinely happened mid-stream.
    expect(countAtScrollUp).toBeLessThan(TOTAL);

    // Let the stream finish while we sit at the top; the follow lock must
    // stay released the whole way.
    await page.waitForFunction(() => window.__doneCount === 30);
    const scrollTop = await page.evaluate(() => window.__scroller!.scrollTop);
    expect(scrollTop).toBe(0);
  });
});
