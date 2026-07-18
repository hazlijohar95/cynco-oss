import { expect, type Page, test } from '@playwright/test';

import { rowByPath } from './helpers/fixtureWindow';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-flatten.html');
  await page.waitForFunction(() => window.__treeFlattenReady === true);
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__visibleCountNow!());
}

test.describe('account tree flattening', () => {
  test('flatten toggle collapses the single-child group chain into one row', async ({
    page,
  }) => {
    await openFixture(page);

    // Unflattened: Assets, Cash, Expenses, Rent, Income, Sales, Online,
    // Lazada, Shopee = 9 rows.
    expect(await visibleCount(page)).toBe(9);

    await page.evaluate(() => window.__setFlatten!(true));
    // Income and Sales fold into the Online row: 2 fewer rows.
    await expect.poll(() => visibleCount(page)).toBe(7);

    await page.evaluate(() => window.__setFlatten!(false));
    await expect.poll(() => visibleCount(page)).toBe(9);
  });

  test('the flattened row renders joined segments with separator styling', async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() => window.__setFlatten!(true));

    const flattened = await rowByPath(page, 'Income:Sales:Online');
    await expect(flattened).toHaveAttribute('data-flattened-row', 'true');

    const segments = flattened.locator('[data-name-segment]');
    await expect(segments).toHaveText(['Income', 'Sales', 'Online']);
    const separators = flattened.locator('[data-name-separator]');
    await expect(separators).toHaveCount(2);
    await expect(separators.first()).toHaveText(':');

    // Separators take the punctuation color, visually distinct from the
    // segment text color.
    const colors = await flattened.evaluate((row) => {
      const segment = row.querySelector('[data-name-segment]');
      const separator = row.querySelector('[data-name-separator]');
      return {
        segment: segment != null ? getComputedStyle(segment).color : null,
        separator: separator != null ? getComputedStyle(separator).color : null,
      };
    });
    expect(colors.segment).not.toBeNull();
    expect(colors.separator).not.toBeNull();
    expect(colors.separator).not.toBe(colors.segment);
  });

  test('selection through the flattened row uses the canonical deep path', async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() => window.__setFlatten!(true));

    const flattened = await rowByPath(page, 'Income:Sales:Online');
    await flattened.click();

    expect(await page.evaluate(() => window.__selectedPaths!())).toEqual([
      'Income:Sales:Online',
    ]);
    await expect(flattened).toHaveAttribute('data-selected', 'true');
    await expect(flattened).toHaveAttribute('aria-selected', 'true');
  });
});
