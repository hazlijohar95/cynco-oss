import { expect, type Locator, type Page, test } from '@playwright/test';

import { rowByPath } from './helpers/fixtureWindow';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-dnd.html');
  await page.waitForFunction(() => window.__treeDndReady === true);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box == null) {
    throw new Error('center: element has no bounding box');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Manual HTML5 drag via trusted mouse input: Playwright's Chromium drag
// interception turns mouse.down + mouse.move over a draggable row into the
// native dragstart/dragover pipeline (the same mechanism locator.dragTo
// uses), which lets the suite pause mid-drag to observe drop-target rings
// and spring-loaded expansion before releasing.
async function startDrag(page: Page, source: Locator) {
  const from = await center(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A couple of short moves cross the drag threshold and emit dragstart.
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
}

// Playwright's interception dispatches `dragenter` when a move crosses onto
// a new element but `dragover` only when consecutive moves stay on the SAME
// element (real browsers instead re-fire dragover on a timer). The trailing
// jiggle moves inside the target row are what make the component's dragover
// handler run mid-drag.
async function dragOver(page: Page, target: Locator) {
  const to = await center(target);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.move(to.x + 3, to.y, { steps: 2 });
  await page.mouse.move(to.x - 3, to.y, { steps: 2 });
}

test.describe('account tree REAL drag & drop', () => {
  test('dragging a leaf onto a valid group fires onMove and re-parents the row', async ({
    page,
  }) => {
    await openFixture(page);

    const source = await rowByPath(page, 'Expenses:Rent');
    const target = await rowByPath(page, 'Income');
    // locator.dragTo drives Chromium's battle-tested native drag handshake.
    await source.dragTo(target);

    await page.waitForFunction(
      () =>
        window.__hasPath!('Income:Rent') === true &&
        window.__hasPath!('Expenses:Rent') === false
    );
    const moves = await page.evaluate(() => window.__moves!);
    expect(moves).toEqual([[{ from: 'Expenses:Rent', to: 'Income:Rent' }]]);

    const moved = await rowByPath(page, 'Income:Rent');
    await expect(moved.locator('[data-name]')).toHaveText('Rent');
    // The drag session cleared: no lingering drag or drop-target visuals.
    expect(await page.evaluate(() => window.__dropTargetPath!())).toBeNull();
  });

  test('hovering a valid target mid-drag shows the drop-target ring', async ({
    page,
  }) => {
    await openFixture(page);

    const source = await rowByPath(page, 'Assets:Current:Cash-CIMB');
    await startDrag(page, source);
    await dragOver(page, await rowByPath(page, 'Income'));

    const income = await rowByPath(page, 'Income');
    await expect(income).toHaveAttribute('data-drop-target', 'true');
    // The ring is real paint: accent-subtle tint plus a 1px inset outline.
    await expect(income).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(income).toHaveCSS('outline-width', '1px');
    // The dragged row dims while in flight.
    await expect(source).toHaveAttribute('data-dragging', 'true');

    await page.mouse.up();
    await page.waitForFunction(
      () => window.__hasPath!('Income:Cash-CIMB') === true
    );
    expect(await page.evaluate(() => window.__dropTargetPath!())).toBeNull();
  });

  test('a descendant drop target is refused: no ring, no move', async ({
    page,
  }) => {
    await openFixture(page);

    const source = await rowByPath(page, 'Assets');
    await startDrag(page, source);
    await dragOver(page, await rowByPath(page, 'Assets:Current'));

    // Give the dragover handler frames to (wrongly) mark the target, then
    // assert it never did.
    await expect
      .poll(() => page.evaluate(() => window.__dropTargetPath!()))
      .toBeNull();
    const current = await rowByPath(page, 'Assets:Current');
    await expect(current).not.toHaveAttribute('data-drop-target', 'true');

    await page.mouse.up();
    expect(await page.evaluate(() => window.__moves!)).toEqual([]);
    expect(
      await page.evaluate(() =>
        window.__hasPath!('Assets:Current:Cash-Maybank')
      )
    ).toBe(true);
  });

  test('spring-loaded expansion opens a collapsed group after the hover delay', async ({
    page,
  }) => {
    await openFixture(page);
    expect(await page.evaluate(() => window.__isExpanded!('Archive'))).toBe(
      false
    );

    const source = await rowByPath(page, 'Assets:Current:Cash-Maybank');
    await startDrag(page, source);
    await dragOver(page, await rowByPath(page, 'Archive'));

    // Hovering the collapsed group for the fixture's 150ms delay auto
    // expands it mid-drag.
    await page.waitForFunction(() => window.__isExpanded!('Archive') === true);
    const child = await rowByPath(page, 'Archive:Old-Ledger');
    await expect(child.locator('[data-name]')).toHaveText('Old-Ledger');

    // Complete the drop into the now-open group.
    await dragOver(page, await rowByPath(page, 'Archive'));
    await page.mouse.up();
    await page.waitForFunction(
      () => window.__hasPath!('Archive:Cash-Maybank') === true
    );
    const moves = await page.evaluate(() => window.__moves!);
    expect(moves.at(-1)).toEqual([
      { from: 'Assets:Current:Cash-Maybank', to: 'Archive:Cash-Maybank' },
    ]);
  });
});
