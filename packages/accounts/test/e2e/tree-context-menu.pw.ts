import { expect, type Page, test } from '@playwright/test';

import { rowByPath } from './helpers/fixtureWindow';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-context-menu.html');
  await page.waitForFunction(() => window.__treeContextMenuReady === true);
}

test.describe('account tree context menu composition', () => {
  test('right-click opens the host menu at the pointer', async ({ page }) => {
    await openFixture(page);

    const row = await rowByPath(page, 'Expenses:Rent');
    const box = await row.boundingBox();
    if (box == null) {
      throw new Error('row has no layout box');
    }
    const clickX = Math.round(box.x + 40);
    const clickY = Math.round(box.y + box.height / 2);
    await page.mouse.click(clickX, clickY, { button: 'right' });

    // The fixture menu is a real positioned popup at the pointer coords.
    const menu = page.locator('#menu');
    await expect(menu).toBeVisible();
    const request = await page.evaluate(() => window.__lastMenuRequest);
    expect(request).toMatchObject({
      path: 'Expenses:Rent',
      paths: ['Expenses:Rent'],
      source: 'pointer',
      anchor: { kind: 'point', x: clickX, y: clickY },
    });
    await expect(menu).toHaveCSS('left', `${clickX}px`);
    await expect(menu).toHaveCSS('top', `${clickY}px`);

    // Right-click also focused + selected the row (standard tree UX).
    expect(await page.evaluate(() => window.__selectedPaths!())).toEqual([
      'Expenses:Rent',
    ]);
  });

  test('Escape closes the menu and focus returns to the originating row', async ({
    page,
  }) => {
    await openFixture(page);

    const row = await rowByPath(page, 'Assets:Current:Cash-CIMB');
    await row.click({ button: 'right' });
    const menu = page.locator('#menu');
    await expect(menu).toBeVisible();
    await expect(menu).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // close() restored DOM focus to the originating row inside the shadow
    // root, and controller focus agrees.
    const index = await page.evaluate(() =>
      window.__rowIndex!('Assets:Current:Cash-CIMB')
    );
    await expect
      .poll(() => page.evaluate(() => window.__shadowActiveRowIndex!()))
      .toBe(String(index));
    expect(await page.evaluate(() => window.__focusedPath!())).toBe(
      'Assets:Current:Cash-CIMB'
    );

    // The restored focus is live: arrows keep working immediately.
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => window.__focusedPath!())).toBe(
      'Assets:Current:Cash-Maybank'
    );
  });

  test('Shift+F10 opens with the row rect anchor', async ({ page }) => {
    await openFixture(page);

    const row = await rowByPath(page, 'Income:Sales');
    await row.click();
    await page.keyboard.press('Shift+F10');

    await expect(page.locator('#menu')).toBeVisible();
    const request = await page.evaluate(() => window.__lastMenuRequest);
    expect(request).toMatchObject({
      path: 'Income:Sales',
      source: 'keyboard',
      anchor: { kind: 'rect' },
    });
  });

  test('menu Rename item performs the restoreFocus:false handoff into the rename input', async ({
    page,
  }) => {
    await openFixture(page);

    const row = await rowByPath(page, 'Expenses:Rent');
    await row.click({ button: 'right' });
    await expect(page.locator('#menu')).toBeVisible();

    await page.locator('#menu-rename').click();
    await expect(page.locator('#menu')).toHaveCount(0);

    // The handoff: close({ restoreFocus: false }) + beginRename left the
    // rename input holding focus — the tree did not steal it back.
    await expect
      .poll(() => page.evaluate(() => window.__activeRename!()))
      .toMatchObject({ focused: true, value: 'Rent' });

    // And the input is fully operational: type + commit.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Sewa');
    await page.keyboard.press('Enter');
    const renamed = await rowByPath(page, 'Expenses:Sewa');
    await expect(renamed.locator('[data-name]')).toHaveText('Sewa');
  });

  test('the row button lane opens with source button', async ({ page }) => {
    await openFixture(page);

    const row = await rowByPath(page, 'Assets:Fixed');
    await row.hover(); // The "…" button is revealed on row hover.
    const button = row.locator('[data-row-action]');
    await expect(button).toBeVisible();
    await button.click();

    await expect(page.locator('#menu')).toBeVisible();
    const request = await page.evaluate(() => window.__lastMenuRequest);
    expect(request).toMatchObject({
      path: 'Assets:Fixed',
      paths: ['Assets:Fixed'],
      source: 'button',
      anchor: { kind: 'rect' },
    });
  });
});
