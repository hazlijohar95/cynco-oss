import { expect, type Page, test } from '@playwright/test';

import { rowByPath } from './helpers/fixtureWindow';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-keyboard.html');
  await page.waitForFunction(() => window.__treeKeyboardReady === true);
}

function focusedPath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__focusedPath!());
}

// Keyboard events are handled by the role="tree" scroller. Full window
// rewrites (expansion/rename rebuilds) destroy row elements, so DOM focus on
// a row does not survive them; the scroller — the aria-activedescendant
// surface — is the stable keyboard target and is refocused between phases.
async function focusTree(page: Page) {
  await page.evaluate(() => window.__focusScroller!());
}

test.describe('account tree real keyboard interaction', () => {
  test('click selects and focuses; ArrowDown/ArrowUp traverse visible rows', async ({
    page,
  }) => {
    await openFixture(page);

    // Visible order is alphabetical within each parent: Cash-CIMB precedes
    // Cash-Maybank, and the collapsed Assets:Fixed group follows them.
    const row = await rowByPath(page, 'Assets:Current:Cash-CIMB');
    await row.click();
    expect(await page.evaluate(() => window.__selectedPaths!())).toEqual([
      'Assets:Current:Cash-CIMB',
    ]);
    expect(await focusedPath(page)).toBe('Assets:Current:Cash-CIMB');

    // The clicked row holds real DOM focus, so arrows bubble to the tree.
    await page.keyboard.press('ArrowDown');
    expect(await focusedPath(page)).toBe('Assets:Current:Cash-Maybank');
    await page.keyboard.press('ArrowDown');
    expect(await focusedPath(page)).toBe('Assets:Fixed');
    await page.keyboard.press('ArrowUp');
    expect(await focusedPath(page)).toBe('Assets:Current:Cash-Maybank');
  });

  test('ArrowRight expands a collapsed group; ArrowLeft collapses then jumps to parent', async ({
    page,
  }) => {
    await openFixture(page);

    const fixed = await rowByPath(page, 'Assets:Fixed');
    await fixed.click();
    expect(await focusedPath(page)).toBe('Assets:Fixed');
    expect(
      await page.evaluate(() => window.__isExpanded!('Assets:Fixed'))
    ).toBe(false);

    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => window.__isExpanded!('Assets:Fixed')))
      .toBe(true);
    const equipment = await rowByPath(page, 'Assets:Fixed:Equipment');
    await expect(equipment.locator('[data-name]')).toHaveText('Equipment');

    // The expansion rebuilt the row window (destroying row focus); keyboard
    // input continues through the tree surface.
    await focusTree(page);
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => page.evaluate(() => window.__isExpanded!('Assets:Fixed')))
      .toBe(false);
    expect(await focusedPath(page)).toBe('Assets:Fixed');

    await focusTree(page);
    await page.keyboard.press('ArrowLeft');
    expect(await focusedPath(page)).toBe('Assets');
  });

  test('F2 opens a focused, fully selected rename input; Enter commits', async ({
    page,
  }) => {
    await openFixture(page);

    const cash = await rowByPath(page, 'Assets:Current:Cash-Maybank');
    await cash.click();
    await page.keyboard.press('F2');

    // The input is rendered into the row, focused, and select-all'd.
    await expect
      .poll(() => page.evaluate(() => window.__activeRename!()))
      .toMatchObject({
        focused: true,
        value: 'Cash-Maybank',
        selectionStart: 0,
        selectionEnd: 'Cash-Maybank'.length,
      });

    // Select-all means typing replaces the whole name.
    await page.keyboard.type('Kas-Utama');
    await page.keyboard.press('Enter');

    await expect
      .poll(() => page.evaluate(() => window.__renames))
      .toEqual([['Assets:Current:Cash-Maybank', 'Assets:Current:Kas-Utama']]);
    const renamed = await rowByPath(page, 'Assets:Current:Kas-Utama');
    await expect(renamed.locator('[data-name]')).toHaveText('Kas-Utama');
    expect(await page.evaluate(() => window.__activeRename!())).toBeNull();
  });

  test('Escape cancels a rename and restores the label', async ({ page }) => {
    await openFixture(page);

    const rent = await rowByPath(page, 'Expenses:Rent');
    await rent.click();
    await page.keyboard.press('F2');
    await expect
      .poll(() => page.evaluate(() => window.__activeRename!()))
      .toMatchObject({ focused: true, value: 'Rent' });

    await page.keyboard.type('Sewa');
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => window.__activeRename!())).toBeNull();
    expect(await page.evaluate(() => window.__renames)).toEqual([]);
    const row = await rowByPath(page, 'Expenses:Rent');
    await expect(row.locator('[data-name]')).toHaveText('Rent');
  });
});
