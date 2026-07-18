import { expect, type Page, test } from '@playwright/test';

import { rowByPath, type TreeReadout } from './helpers/fixtureWindow';

const ROW_HEIGHT = 30;
// Viewport (480px / 30px = 16 rows) + 2x10 overscan = ~37 rendered rows; the
// bound leaves headroom without ever allowing an unbounded DOM.
const MAX_DOM_ROWS = 80;

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-virtualization-sticky.html');
  await page.waitForFunction(() => window.__treeVirtualizationReady === true);
}

async function scrollTo(page: Page, scrollTop: number) {
  await page.evaluate((top) => {
    window.__scroller!.scrollTop = top;
  }, scrollTop);
}

async function readout(page: Page): Promise<TreeReadout> {
  return page.evaluate(() => window.__readout!());
}

function expectSpacersTile(state: TreeReadout, totalCount: number) {
  expect(state.before + state.after + state.renderedCount * ROW_HEIGHT).toBe(
    totalCount * ROW_HEIGHT
  );
}

test.describe('account tree virtualization + sticky header', () => {
  test('DOM row count stays bounded while scrolling a large tree', async ({
    page,
  }) => {
    await openFixture(page);
    const totalCount = await page.evaluate(() => window.__visibleCount!);
    expect(totalCount).toBe(2238);

    // Top.
    let state = await readout(page);
    expect(state.renderedCount).toBeGreaterThan(0);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.before).toBe(0);
    expectSpacersTile(state, totalCount);

    // Middle: wait for the window to include the target row.
    const midIndex = await page.evaluate(() =>
      window.__rowIndex!('Group3:Mid05:Leaf10')
    );
    await scrollTo(page, midIndex * ROW_HEIGHT);
    await page.waitForFunction(
      (index) =>
        window.__scroller!.querySelector(
          `[data-rows] [data-row][data-row-index="${index}"]`
        ) != null,
      midIndex
    );
    state = await readout(page);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.before).toBeGreaterThan(0);
    expect(state.after).toBeGreaterThan(0);
    expectSpacersTile(state, totalCount);

    // Bottom.
    await page.evaluate(() => {
      const scroller = window.__scroller!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForFunction(
      (last) =>
        window.__scroller!.querySelector(
          `[data-rows] [data-row][data-row-index="${last}"]`
        ) != null,
      totalCount - 1
    );
    state = await readout(page);
    expect(state.renderedCount).toBeLessThan(MAX_DOM_ROWS);
    expect(state.after).toBe(0);
    expectSpacersTile(state, totalCount);

    // The last row is the deepest leaf of the last subtree.
    const lastRow = await rowByPath(page, 'Group5:Mid11:Leaf29');
    await expect(lastRow.locator('[data-name]')).toHaveText('Leaf29');
  });

  test('sticky header mirrors the correct ancestor group while scrolling a deep subtree', async ({
    page,
  }) => {
    await openFixture(page);

    // Scroll so the top visible row is a leaf deep inside Group3 > Mid07.
    const leafIndex = await page.evaluate(() =>
      window.__rowIndex!('Group3:Mid07:Leaf15')
    );
    await scrollTo(page, leafIndex * ROW_HEIGHT + 10);
    await expect
      .poll(async () => (await page.evaluate(() => window.__sticky!())).name)
      .toBe('Mid07');

    // Scroll a bit deeper within the same subtree: still Mid07.
    await scrollTo(page, (leafIndex + 8) * ROW_HEIGHT + 10);
    await expect
      .poll(async () => (await page.evaluate(() => window.__sticky!())).name)
      .toBe('Mid07');

    // Cross into the next subtree: the sticky ancestor advances with it.
    const nextLeafIndex = await page.evaluate(() =>
      window.__rowIndex!('Group3:Mid08:Leaf03')
    );
    await scrollTo(page, nextLeafIndex * ROW_HEIGHT + 10);
    await expect
      .poll(async () => (await page.evaluate(() => window.__sticky!())).name)
      .toBe('Mid08');
  });

  test('sticky row is aria-hidden and never a treeitem', async ({ page }) => {
    await openFixture(page);

    const leafIndex = await page.evaluate(() =>
      window.__rowIndex!('Group2:Mid03:Leaf20')
    );
    await scrollTo(page, leafIndex * ROW_HEIGHT + 10);
    await expect
      .poll(async () => (await page.evaluate(() => window.__sticky!())).hidden)
      .toBe(false);

    const sticky = await page.evaluate(() => window.__sticky!());
    expect(sticky.stickyRow).toBe('true');
    expect(sticky.ariaHidden).toBe('true');
    expect(sticky.role).toBeFalsy();
    expect(sticky.treeitemCount).toBe(0);
  });
});
