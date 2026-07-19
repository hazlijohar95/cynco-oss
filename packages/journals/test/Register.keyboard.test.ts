import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { RegisterRowData, RegisterSelectionChange } from '../src/types';
import {
  dispatchKey,
  dispatchScroll,
  type DomHandle,
  installDom,
  makeRows,
  stubScrollerGeometry,
  wait,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const ROW_COUNT = 200;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + ROW_COUNT * LINE_HEIGHT;
// PageUp/PageDown stride: entry rows below the sticky header.
const PAGE_SIZE = Math.floor((VIEWPORT_HEIGHT - HEADER_HEIGHT) / LINE_HEIGHT);

interface FocusEvent {
  index: number | null;
  row: RegisterRowData | null;
}

interface Harness {
  register: Register;
  section: HTMLElement;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  selections: RegisterSelectionChange[];
  rowSelects: number[];
  focusEvents: FocusEvent[];
  cleanUp(): void;
}

async function createHarness(
  options: Partial<RegisterOptions> = {},
  rows: readonly RegisterRowData[] = makeRows(ROW_COUNT),
  // Grouped fixtures pass their true content height (group headers add
  // 28px each): scroll targets now clamp against scrollHeight, so a stale
  // flat stub would clamp reveals short of the real grouped positions.
  scrollHeight: number = SCROLL_HEIGHT
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const selections: RegisterSelectionChange[] = [];
  const rowSelects: number[] = [];
  const focusEvents: FocusEvent[] = [];
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    id: 'kb',
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
    onSelectionChange(selection) {
      selections.push(selection);
    },
    onRowSelect(_row, index) {
      rowSelects.push(index);
    },
    onFocusChange(index, row) {
      focusEvents.push({ index, row });
    },
    ...options,
  });
  register.render({ rows, container, parentNode: document.body });
  const shadowRoot = container.shadowRoot;
  const section = shadowRoot?.querySelector('[data-register]');
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  if (
    !(section instanceof HTMLElement) ||
    !(scroller instanceof HTMLElement) ||
    !(rowsElement instanceof HTMLElement)
  ) {
    throw new Error('createHarness: register skeleton missing');
  }
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight,
  });
  await wait(0);
  return {
    register,
    section,
    scroller,
    rowsElement,
    selections,
    rowSelects,
    focusEvents,
    cleanUp() {
      register.cleanUp();
    },
  };
}

function clickRow(
  harness: Harness,
  index: number,
  init: MouseEventInit = {}
): void {
  const row = harness.rowsElement.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`clickRow: row ${index} is not rendered`);
  }
  row.dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true, ...init })
  );
}

function selectedIndexesInDom(harness: Harness): number[] {
  return Array.from(
    harness.rowsElement.querySelectorAll('[data-row-selected="true"]')
  ).map((row) => Number(row.getAttribute('data-row-index')));
}

function activeDescendant(harness: Harness): string | null {
  return harness.section.getAttribute('aria-activedescendant');
}

describe('arrow navigation', () => {
  test('ArrowDown from nothing focuses row 0, then walks down; ArrowUp walks back', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(0);
    expect(activeDescendant(harness)).toBe('kb-row-0');
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(2);
    expect(activeDescendant(harness)).toBe('kb-row-2');
    dispatchKey(harness.section, 'ArrowUp');
    expect(harness.register.getFocusedRow()).toBe(1);
    // The focused row carries the styling hook.
    expect(
      harness.rowsElement
        .querySelector('[data-row-index="1"]')
        ?.getAttribute('data-focused')
    ).toBe('true');
    expect(harness.rowsElement.querySelectorAll('[data-focused]').length).toBe(
      1
    );
    harness.cleanUp();
  });

  test('arrows clamp at both edges without a boundary host', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowUp'); // From nothing: last row.
    expect(harness.register.getFocusedRow()).toBe(ROW_COUNT - 1);
    dispatchKey(harness.section, 'ArrowDown'); // Clamped in place.
    expect(harness.register.getFocusedRow()).toBe(ROW_COUNT - 1);
    harness.register.focusRow(0);
    dispatchKey(harness.section, 'ArrowUp');
    expect(harness.register.getFocusedRow()).toBe(0);
    harness.cleanUp();
  });

  test('arrows preventDefault so the page never scrolls', async () => {
    const harness = await createHarness();
    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    harness.section.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    harness.cleanUp();
  });

  test('grouped registers navigate entry space: group rows are skipped', async () => {
    const rows = makeRows(ROW_COUNT).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: index < 100 ? '2026-01-15' : '2026-02-15',
      },
    }));
    const harness = await createHarness({ groupBy: 'month' }, rows);
    harness.register.focusRow(99); // Last entry of January.
    await wait(0); // Reveal re-windows on the rAF queue.
    dispatchKey(harness.section, 'ArrowDown');
    // The February group header sits between them in the DOM, but focus
    // moves straight to entry 100 — navigation is entry-index space.
    expect(harness.register.getFocusedRow()).toBe(100);
    await wait(0);
    expect(activeDescendant(harness)).toBe('kb-row-100');
    harness.cleanUp();
  });
});

describe('Home / End / paging', () => {
  test('Home and End jump to the first and last entry rows', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'End');
    expect(harness.register.getFocusedRow()).toBe(ROW_COUNT - 1);
    dispatchKey(harness.section, 'Home');
    expect(harness.register.getFocusedRow()).toBe(0);
    harness.cleanUp();
  });

  test('PageDown/PageUp move by a viewport of entry rows and clamp', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown'); // Row 0.
    dispatchKey(harness.section, 'PageDown');
    expect(harness.register.getFocusedRow()).toBe(PAGE_SIZE);
    dispatchKey(harness.section, 'PageUp');
    expect(harness.register.getFocusedRow()).toBe(0);
    dispatchKey(harness.section, 'PageUp'); // Clamps at 0.
    expect(harness.register.getFocusedRow()).toBe(0);
    harness.register.focusRow(ROW_COUNT - 3);
    dispatchKey(harness.section, 'PageDown'); // Clamps at the end.
    expect(harness.register.getFocusedRow()).toBe(ROW_COUNT - 1);
    harness.cleanUp();
  });
});

describe('selection keys', () => {
  test('Enter selects the focused row exactly like a plain click', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'Enter');
    expect(harness.register.getSelectedRow()).toBe(1);
    expect(selectedIndexesInDom(harness)).toEqual([1]);
    expect(harness.rowSelects).toEqual([1]);
    expect(harness.selections[harness.selections.length - 1].indexes).toEqual([
      1,
    ]);
    harness.cleanUp();
  });

  test('Space behaves like Enter; in range mode it sets the anchor like a click', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    harness.register.focusRow(4);
    dispatchKey(harness.section, ' ');
    expect(harness.register.getSelection()).toEqual({
      anchor: 4,
      indexes: new Set([4]),
    });
    harness.cleanUp();
  });

  test('Shift+Arrow extension produces the exact shift-click selection states', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5); // Anchor at 5, pointer style.
    dispatchKey(harness.section, 'ArrowDown', { shiftKey: true });
    dispatchKey(harness.section, 'ArrowDown', { shiftKey: true });
    expect(harness.register.getSelection()).toEqual({
      anchor: 5,
      indexes: new Set([5, 6, 7]),
    });
    // Now extend upward past the anchor — same anchor, flipped range,
    // exactly what shift-clicking row 3 produces.
    dispatchKey(harness.section, 'ArrowUp', { shiftKey: true });
    dispatchKey(harness.section, 'ArrowUp', { shiftKey: true });
    dispatchKey(harness.section, 'ArrowUp', { shiftKey: true });
    dispatchKey(harness.section, 'ArrowUp', { shiftKey: true });
    expect(harness.register.getSelection()).toEqual({
      anchor: 5,
      indexes: new Set([3, 4, 5]),
    });
    // Byte-level parity check against the pointer path.
    const pointer = await createHarness({ selectionMode: 'range' });
    clickRow(pointer, 5);
    clickRow(pointer, 3, { shiftKey: true });
    expect(pointer.register.getSelection()).toEqual(
      harness.register.getSelection()
    );
    pointer.cleanUp();
    harness.cleanUp();
  });

  test('Shift+Arrow in single mode just moves focus', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'ArrowDown', { shiftKey: true });
    expect(harness.register.getFocusedRow()).toBe(1);
    expect(harness.register.getSelection().indexes.size).toBe(0);
    harness.cleanUp();
  });

  test('Meta+A selects every entry row in range mode and is ignored in single mode', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    dispatchKey(harness.section, 'a', { metaKey: true });
    expect(harness.register.getSelection().indexes.size).toBe(ROW_COUNT);
    expect(harness.selections.length).toBe(1);
    harness.cleanUp();

    const single = await createHarness();
    dispatchKey(single.section, 'a', { ctrlKey: true });
    expect(single.register.getSelection().indexes.size).toBe(0);
    expect(single.selections.length).toBe(0);
    single.cleanUp();
  });

  test('Escape clears the selection and only fires when something was selected', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    dispatchKey(harness.section, 'Escape'); // Empty: no callback.
    expect(harness.selections.length).toBe(0);
    clickRow(harness, 3);
    clickRow(harness, 6, { shiftKey: true });
    const before = harness.selections.length;
    dispatchKey(harness.section, 'Escape');
    expect(harness.register.getSelection()).toEqual({
      anchor: null,
      indexes: new Set(),
    });
    expect(selectedIndexesInDom(harness)).toEqual([]);
    expect(harness.selections.length).toBe(before + 1);
    expect(harness.selections[harness.selections.length - 1].indexes).toEqual(
      []
    );
    dispatchKey(harness.section, 'Escape'); // Cleared: silent again.
    expect(harness.selections.length).toBe(before + 1);
    harness.cleanUp();
  });

  test('Escape also clears in single mode', async () => {
    const harness = await createHarness();
    clickRow(harness, 2);
    dispatchKey(harness.section, 'Escape');
    expect(harness.register.getSelectedRow()).toBeNull();
    expect(selectedIndexesInDom(harness)).toEqual([]);
    harness.cleanUp();
  });
});

describe('IME guard', () => {
  test('composing keydowns are ignored entirely', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 3);
    dispatchKey(harness.section, 'ArrowDown', { isComposing: true });
    expect(harness.register.getFocusedRow()).toBe(3);
    dispatchKey(harness.section, 'Escape', { isComposing: true });
    expect(harness.register.getSelection().indexes).toEqual(new Set([3]));
    harness.cleanUp();
  });
});

describe('activedescendant and focus reveal under virtualization', () => {
  test('activedescendant is cleared when the focused row is evicted, restored when it returns', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    expect(activeDescendant(harness)).toBe('kb-row-0');
    // Scroll far enough that row 0 leaves the rendered window (windowing is
    // driven by the scroll handler, not focus).
    harness.scroller.scrollTop = 2_500;
    dispatchScroll(harness.scroller);
    await wait(0);
    expect(
      harness.rowsElement.querySelector('[data-row-index="0"]')
    ).toBeNull();
    expect(activeDescendant(harness)).toBeNull();
    // Scroll back: the re-rendered window restores both the attribute and
    // the focused row's styling hook.
    harness.scroller.scrollTop = 0;
    dispatchScroll(harness.scroller);
    await wait(0);
    expect(activeDescendant(harness)).toBe('kb-row-0');
    expect(
      harness.rowsElement
        .querySelector('[data-row-index="0"]')
        ?.getAttribute('data-focused')
    ).toBe('true');
    harness.cleanUp();
  });

  test('End reveals the last row: scrollTop jumps so the row is inside the viewport', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'End');
    // Last row top = 44 + 199*20 = 4024; bottom-align: 4024 + 20 - 400.
    expect(harness.scroller.scrollTop).toBe(
      HEADER_HEIGHT +
        (ROW_COUNT - 1) * LINE_HEIGHT +
        LINE_HEIGHT -
        VIEWPORT_HEIGHT
    );
    await wait(0);
    // The re-windowed DOM materializes the focused row.
    expect(
      harness.rowsElement.querySelector(`[data-row-index="${ROW_COUNT - 1}"]`)
    ).not.toBeNull();
    expect(activeDescendant(harness)).toBe(`kb-row-${ROW_COUNT - 1}`);
    harness.cleanUp();
  });

  test('upward reveal lands the row below the sticky header', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'End');
    await wait(0);
    dispatchKey(harness.section, 'Home');
    // Row 0 top is 44; revealing it subtracts the header height → 0.
    expect(harness.scroller.scrollTop).toBe(0);
    harness.cleanUp();
  });

  test('grouped reveal uses prefix-sum offsets (group headers shift row tops)', async () => {
    const rows = makeRows(ROW_COUNT).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: index < 100 ? '2026-01-15' : '2026-02-15',
      },
    }));
    const harness = await createHarness(
      { groupBy: 'month' },
      rows,
      // 2 month group headers at 28px on top of the flat content height.
      SCROLL_HEIGHT + 2 * 28
    );
    dispatchKey(harness.section, 'End');
    // Last entry top = header 44 + 2 group headers (28px) + 199 rows (20px)
    // = 4080; bottom-align: 4080 + 20 - 400 = 3700.
    expect(harness.scroller.scrollTop).toBe(3700);
    harness.cleanUp();
  });

  test('reveal is a no-op when the row is already visible', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.scroller.scrollTop).toBe(0);
    harness.cleanUp();
  });
});

describe('focus callbacks and pointer integration', () => {
  test('onFocusChange fires with the entry index and row payload', async () => {
    const harness = await createHarness();
    dispatchKey(harness.section, 'ArrowDown');
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.focusEvents.map((event) => event.index)).toEqual([0, 1]);
    expect(harness.focusEvents[1].row?.entry.id).toBe('entry-1');
    harness.cleanUp();
  });

  test('pointer clicks set the focused row so keyboard continues from there', async () => {
    const harness = await createHarness();
    clickRow(harness, 7);
    expect(harness.register.getFocusedRow()).toBe(7);
    expect(activeDescendant(harness)).toBe('kb-row-7');
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(8);
    expect(harness.focusEvents.map((event) => event.index)).toEqual([7, 8]);
    harness.cleanUp();
  });

  test('with no focus yet, arrows pick up from a pointer selection primary', async () => {
    const harness = await createHarness();
    clickRow(harness, 10);
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(11);
    harness.cleanUp();
  });
});

describe('disableKeyboardNavigation escape hatch', () => {
  test('no tab stop, no keydown handling, pointer selection untouched', async () => {
    const harness = await createHarness({ disableKeyboardNavigation: true });
    expect(harness.section.hasAttribute('tabindex')).toBe(false);
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBeNull();
    expect(activeDescendant(harness)).toBeNull();
    clickRow(harness, 4);
    expect(harness.register.getSelectedRow()).toBe(4);
    harness.cleanUp();
  });
});
