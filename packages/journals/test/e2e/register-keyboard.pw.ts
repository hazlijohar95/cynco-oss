import { expect, type Page, test } from '@playwright/test';

interface RegisterKeyboardReadout {
  gridHasFocus: boolean;
  activeDescendant: string | null;
  focusedIndex: number | null;
  focusedOutline: string | null;
  selectedIndexes: number[];
}

declare global {
  interface Window {
    __registerKeyboardReady?: boolean;
    __scroller?: HTMLElement;
    __keyboardReadout?: () => RegisterKeyboardReadout;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/register-keyboard.html');
  await page.waitForFunction(() => window.__registerKeyboardReady === true);
}

async function readout(page: Page): Promise<RegisterKeyboardReadout> {
  return page.evaluate(() => window.__keyboardReadout!());
}

test.describe('register keyboard navigation against built dist', () => {
  test('Tab reaches the grid; arrows move virtual focus with a visible ring', async ({
    page,
  }) => {
    await openFixture(page);

    // The grid is the page's only tab stop: one Tab lands on it.
    await page.keyboard.press('Tab');
    let state = await readout(page);
    expect(state.gridHasFocus).toBe(true);
    expect(state.activeDescendant).toBeNull(); // No row focused yet.

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    state = await readout(page);
    expect(state.activeDescendant).toBe('e2e-reg-row-1');
    expect(state.focusedIndex).toBe(1);
    // Keyboard interaction makes :focus-visible match, which gates the
    // focused row's accent outline.
    expect(state.focusedOutline).toBe('solid');
  });

  test('Enter anchors, Shift+ArrowDown extends the selection, Escape clears it', async ({
    page,
  }) => {
    await openFixture(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    // Enter selects the focused row and sets the range anchor.
    await page.keyboard.press('Enter');
    let state = await readout(page);
    expect(state.selectedIndexes).toEqual([1]);

    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    state = await readout(page);
    expect(state.selectedIndexes).toEqual([1, 2, 3]);
    expect(state.activeDescendant).toBe('e2e-reg-row-3');

    await page.keyboard.press('Escape');
    state = await readout(page);
    expect(state.selectedIndexes).toEqual([]);
    // Focus is untouched by Escape — only the selection clears.
    expect(state.focusedIndex).toBe(3);
  });

  test('End reveals the last virtualized row and repoints activedescendant', async ({
    page,
  }) => {
    await openFixture(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');

    await page.keyboard.press('End');
    // The reveal adjusted scrollTop instantly; the re-windowed row then
    // materializes on the rAF queue.
    await page.waitForFunction(
      () => window.__keyboardReadout!().activeDescendant === 'e2e-reg-row-199'
    );
    const scrollTop = await page.evaluate(() => window.__scroller!.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    const state = await readout(page);
    expect(state.focusedIndex).toBe(199);
  });
});
