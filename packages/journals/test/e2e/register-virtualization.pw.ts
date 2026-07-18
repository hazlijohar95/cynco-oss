import { expect, type Page, test } from '@playwright/test';

interface VirtualizationReadout {
  renderedCount: number;
  before: number;
  after: number;
}

declare global {
  interface Window {
    __registerVirtualizationReady?: boolean;
    __scroller?: HTMLElement;
    __rowCount?: number;
    __rowHeight?: number;
    __headerHeight?: number;
    __readout?: () => VirtualizationReadout;
  }
}

const ROW_COUNT = 10_000;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 44;
// Viewport (480) + 2x800 overscroll = 52 rows, + 2x10 overscan = 72; the
// bound leaves headroom for off-by-a-row window math without ever allowing
// an unbounded DOM.
const MAX_DOM_ROWS = 80;

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/register-virtualization.html');
  await page.waitForFunction(
    () => window.__registerVirtualizationReady === true
  );
}

// Scrolls the shadow scroller and waits for the row window to settle on a
// range containing `expectIndex`.
async function scrollToAndWaitForRow(
  page: Page,
  scrollTop: number,
  expectIndex: number
) {
  await page.evaluate((top) => {
    window.__scroller!.scrollTop = top;
  }, scrollTop);
  await page.waitForFunction((index) => {
    const scroller = window.__scroller!;
    return scroller.querySelector(`[data-row-index="${index}"]`) != null;
  }, expectIndex);
}

async function readout(page: Page): Promise<VirtualizationReadout> {
  return page.evaluate(() => window.__readout!());
}

// Spacer heights plus rendered rows must always tile the full content
// height exactly — any drift would desynchronize scrollbar geometry.
function expectSpacersTile(state: VirtualizationReadout) {
  expect(state.before + state.after + state.renderedCount * ROW_HEIGHT).toBe(
    ROW_COUNT * ROW_HEIGHT
  );
}

test.describe('register virtualization under real scrolling', () => {
  test('DOM row count stays bounded at top, middle, and bottom', async ({
    page,
  }) => {
    await openFixture(page);

    // Top: initial window starts at row 0.
    await page.waitForFunction(() => {
      const state = window.__readout!();
      return state.renderedCount > 0;
    });
    let state = await readout(page);
    expect(state.renderedCount).toBeGreaterThan(0);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.before).toBe(0);
    expectSpacersTile(state);

    // Middle.
    await scrollToAndWaitForRow(page, HEADER_HEIGHT + 5000 * ROW_HEIGHT, 5000);
    state = await readout(page);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.before).toBeGreaterThan(0);
    expect(state.after).toBeGreaterThan(0);
    expectSpacersTile(state);

    // Bottom.
    await page.evaluate(() => {
      const scroller = window.__scroller!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForFunction(
      (last) =>
        window.__scroller!.querySelector(`[data-row-index="${last}"]`) != null,
      ROW_COUNT - 1
    );
    state = await readout(page);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.after).toBe(0);
    expectSpacersTile(state);
  });

  test('target row content is correct after scrollTo jumps', async ({
    page,
  }) => {
    await openFixture(page);

    for (const index of [2500, 8641, 137]) {
      await scrollToAndWaitForRow(
        page,
        HEADER_HEIGHT + index * ROW_HEIGHT - 100,
        index
      );
      const row = page.locator(
        `journals-container [data-row-index="${index}"]`
      );
      await expect(row.locator('[data-payee]')).toHaveText(`Payee ${index}`);
      await expect(row.locator('[data-narration]')).toHaveText(
        `Narration ${index}`
      );
      const expectedDay = String((index % 28) + 1).padStart(2, '0');
      await expect(row.locator('[data-cell="date"]')).toHaveText(
        `2026-07-${expectedDay}`
      );
    }
  });

  test('no blank viewport immediately after a fast scroll jump', async ({
    page,
  }) => {
    await openFixture(page);
    await page.waitForFunction(() => window.__readout!().renderedCount > 0);

    // Jump far past the overscroll buffer, then verify a rendered row covers
    // the viewport within the component's own frame budget (its commits ride
    // the rAF queue; we allow a handful of frames, never wall-clock sleeps).
    const result = await page.evaluate(async () => {
      const scroller = window.__scroller!;
      scroller.scrollTop = 123_456;
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      for (let frame = 0; frame < 10; frame += 1) {
        await nextFrame();
        const viewport = scroller.getBoundingClientRect();
        const rows = scroller.querySelectorAll(
          '[data-register-rows] [data-row]'
        );
        for (const row of rows) {
          const rect = row.getBoundingClientRect();
          if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
            return { covered: true, frame };
          }
        }
      }
      return { covered: false, frame: -1 };
    });

    expect(result.covered).toBe(true);
  });
});
