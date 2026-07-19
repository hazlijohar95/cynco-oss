// Real-browser coverage for the three v2 features: hide-non-matches
// filtering (recomputed aria-posinset/setsize), F3 match cycling, the
// stacked sticky ancestor header (with click forwarding), and measured
// middle truncation — all on one fixture mounted with
// `stickyAncestors: 'stack'` + `nameTruncation: 'middle'`.

import { expect, type Page, test } from '@playwright/test';

import { rowByPath } from './helpers/fixtureWindow';

const ROW_HEIGHT = 30;

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-search-sticky-stack.html');
  await page.waitForFunction(() => window.__treeSearchStickyReady === true);
}

async function scrollTo(page: Page, scrollTop: number) {
  await page.evaluate((top) => {
    window.__scroller!.scrollTop = top;
  }, scrollTop);
}

test.describe('search modes + sticky stack + truncation', () => {
  test('hide-non-matches filters the projection and recomputes posinset', async ({
    page,
  }) => {
    await openFixture(page);
    const fullCount = await page.evaluate(() => window.__visibleCountNow!());

    await page.evaluate(() =>
      window.__beginSearch!('Mid07', 'hide-non-matches')
    );
    const filteredCount = await page.evaluate(() =>
      window.__visibleCountNow!()
    );
    // 6 groups + 6 Mid07s + 6 × 30 leaves — every other subtree filtered.
    expect(filteredCount).toBe(6 + 6 + 6 * 30);
    expect(await page.evaluate(() => window.__rowIndex!('Group0:Mid00'))).toBe(
      -1
    );

    // Mid07 is canonically sibling 8 of 12; in the filtered projection it
    // is the ONLY visible child of its group and must say so.
    const mid = await rowByPath(page, 'Group0:Mid07');
    await expect(mid).toHaveAttribute('aria-posinset', '1');
    await expect(mid).toHaveAttribute('aria-setsize', '1');

    await page.evaluate(() => window.__endSearch!());
    expect(await page.evaluate(() => window.__visibleCountNow!())).toBe(
      fullCount
    );
  });

  test('F3 / Shift+F3 cycle search matches with a live {index,total}', async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() => {
      window.__beginSearch!('alpha');
      window.__focusScroller!();
    });
    // 'alpha' matches Deep:Alpha plus its whole subtree (segment match):
    // 1 + 1 (Beta) + 1 (Gamma) + 30 leaves.
    expect(await page.evaluate(() => window.__matchState!())).toEqual({
      index: 1,
      total: 33,
    });

    await page.keyboard.press('F3');
    expect(await page.evaluate(() => window.__focusedPath!())).toBe(
      'Deep:Alpha'
    );
    await page.keyboard.press('F3');
    expect(await page.evaluate(() => window.__focusedPath!())).toBe(
      'Deep:Alpha:Beta'
    );
    expect(await page.evaluate(() => window.__matchState!())).toEqual({
      index: 2,
      total: 33,
    });
    await page.keyboard.press('Shift+F3');
    expect(await page.evaluate(() => window.__focusedPath!())).toBe(
      'Deep:Alpha'
    );
    // Shift+F3 from the first match wraps to the last (cyclic).
    await page.keyboard.press('Shift+F3');
    expect(await page.evaluate(() => window.__matchState!())).toEqual({
      index: 33,
      total: 33,
    });
  });

  test('sticky stack mirrors the ancestor chain and forwards clicks', async ({
    page,
  }) => {
    await openFixture(page);
    const leafIndex = await page.evaluate(() =>
      window.__rowIndex!('Deep:Alpha:Beta:Gamma:Leaf15')
    );
    await scrollTo(page, leafIndex * ROW_HEIGHT + 10);

    await expect
      .poll(
        async () => (await page.evaluate(() => window.__stickyStack!())).names
      )
      .toEqual(['Deep', 'Alpha', 'Beta', 'Gamma']);
    const stack = await page.evaluate(() => window.__stickyStack!());
    expect(stack.hidden).toBe(false);
    expect(stack.ariaHidden).toEqual(['true', 'true', 'true', 'true']);
    expect(stack.treeitemCount).toBe(0);
    expect(stack.paths[2]).toBe('Deep:Alpha:Beta');

    // Clicking a mirror scrolls to and focuses the REAL ancestor row.
    await page
      .locator(
        'accounts-container [data-sticky-header] [data-row][data-path="Deep:Alpha:Beta"]'
      )
      .click();
    await expect
      .poll(() => page.evaluate(() => window.__focusedPath!()))
      .toBe('Deep:Alpha:Beta');
    const beta = await rowByPath(page, 'Deep:Alpha:Beta');
    await expect(beta).toHaveAttribute('data-focused', 'true');
  });

  test('long names middle-truncate with the full name in title', async ({
    page,
  }) => {
    await openFixture(page);
    const longRow = await rowByPath(
      page,
      'Assets:VeryVeryLongAccountNameThatOverflows-Ending'
    );
    await longRow.scrollIntoViewIfNeeded();
    const name = longRow.locator('[data-name]');
    await expect(name).toHaveAttribute(
      'title',
      'VeryVeryLongAccountNameThatOverflows-Ending'
    );
    const text = (await name.textContent()) ?? '';
    expect(text).toContain('…');
    // End-priority: the distinguishing tail survives the middle cut.
    expect(text.endsWith('-Ending')).toBe(true);

    // Short names carry no tooltip noise. The row sits outside the initial
    // window, so scroll the virtualizer (not the locator — the element does
    // not exist until its window commits).
    const shortIndex = await page.evaluate(() =>
      window.__rowIndex!('Group0:Mid00:Leaf00')
    );
    await scrollTo(page, shortIndex * ROW_HEIGHT);
    await page.waitForFunction(
      (index) =>
        window.__scroller!.querySelector(
          `[data-rows] [data-row][data-row-index="${index}"]`
        ) != null,
      shortIndex
    );
    const shortRow = await rowByPath(page, 'Group0:Mid00:Leaf00');
    await expect(shortRow.locator('[data-name]')).not.toHaveAttribute(
      'title',
      /.+/
    );
  });
});
