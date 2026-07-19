import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { RegisterRowData, RegisterSelectionChange } from '../src/types';
import {
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

interface Harness {
  register: Register;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  selections: RegisterSelectionChange[];
  rowSelects: { row: RegisterRowData; index: number }[];
  cleanUp(): void;
}

async function createHarness(
  options: Partial<RegisterOptions> = {}
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const selections: RegisterSelectionChange[] = [];
  const rowSelects: { row: RegisterRowData; index: number }[] = [];
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
    onSelectionChange(selection) {
      selections.push(selection);
    },
    onRowSelect(row, index) {
      rowSelects.push({ row, index });
    },
    ...options,
  });
  register.render({
    rows: makeRows(ROW_COUNT),
    container,
    parentNode: document.body,
  });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  if (
    !(scroller instanceof HTMLElement) ||
    !(rowsElement instanceof HTMLElement)
  ) {
    throw new Error('createHarness: register skeleton missing');
  }
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: SCROLL_HEIGHT,
  });
  await wait(0);
  return {
    register,
    scroller,
    rowsElement,
    selections,
    rowSelects,
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

async function scrollTo(harness: Harness, scrollTop: number): Promise<void> {
  harness.scroller.scrollTop = scrollTop;
  dispatchScroll(harness.scroller);
  await wait(0);
}

describe('single mode (default) stays unchanged', () => {
  test('click selects exactly one row; the next click moves the selection', async () => {
    const harness = await createHarness();
    clickRow(harness, 5);
    expect(harness.register.getSelectedRow()).toBe(5);
    expect(selectedIndexesInDom(harness)).toEqual([5]);
    clickRow(harness, 7);
    expect(harness.register.getSelectedRow()).toBe(7);
    expect(selectedIndexesInDom(harness)).toEqual([7]);
    expect(harness.rowSelects.map((event) => event.index)).toEqual([5, 7]);
    harness.cleanUp();
  });

  test('modifiers are ignored in single mode', async () => {
    const harness = await createHarness();
    clickRow(harness, 5);
    clickRow(harness, 9, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([9]);
    clickRow(harness, 3, { metaKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([3]);
    harness.cleanUp();
  });

  test('onSelectionChange reports the 1-row selection alongside onRowSelect', async () => {
    const harness = await createHarness();
    clickRow(harness, 4);
    expect(harness.selections).toEqual([
      { indexes: [4], rows: [harness.selections[0].rows[0]] },
    ]);
    expect(harness.selections[0].rows[0].entry.id).toBe('entry-4');
    harness.cleanUp();
  });
});

describe('range mode selection semantics', () => {
  test('plain click selects one row and sets the anchor', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    expect(harness.register.getSelection()).toEqual({
      anchor: 5,
      indexes: new Set([5]),
    });
    harness.cleanUp();
  });

  test('shift-click extends anchor→target contiguously, in either direction', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    clickRow(harness, 9, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([5, 6, 7, 8, 9]);
    // Anchor stays at 5, so a shift-click above re-extends from 5 downward.
    clickRow(harness, 3, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([3, 4, 5]);
    expect(harness.register.getSelection().anchor).toBe(5);
    harness.cleanUp();
  });

  test('meta/ctrl-click toggles rows in and out (non-contiguous allowed)', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    clickRow(harness, 9, { shiftKey: true });
    clickRow(harness, 7, { metaKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([5, 6, 8, 9]);
    clickRow(harness, 12, { ctrlKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([5, 6, 8, 9, 12]);
    // Meta-adding moved the anchor to 12: shift-click extends from there.
    clickRow(harness, 14, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([12, 13, 14]);
    harness.cleanUp();
  });

  test('meta-removing the anchor row clears the anchor', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    clickRow(harness, 5, { metaKey: true });
    expect(harness.register.getSelection()).toEqual({
      anchor: null,
      indexes: new Set(),
    });
    // With no anchor, shift-click behaves like a plain click.
    clickRow(harness, 8, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([8]);
    harness.cleanUp();
  });

  test('onSelectionChange payload carries sorted indexes and matching rows; onRowSelect keeps firing for the clicked row', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 9);
    clickRow(harness, 5, { shiftKey: true });
    const last = harness.selections[harness.selections.length - 1];
    expect(last.indexes).toEqual([5, 6, 7, 8, 9]);
    expect(last.rows.map((row) => row.entry.id)).toEqual([
      'entry-5',
      'entry-6',
      'entry-7',
      'entry-8',
      'entry-9',
    ]);
    expect(harness.rowSelects.map((event) => event.index)).toEqual([9, 5]);
    harness.cleanUp();
  });

  test('selection survives re-windowing: attributes reappear when rows re-enter the DOM', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    clickRow(harness, 8, { shiftKey: true });
    // Scroll far enough that rows 5..8 leave the rendered window entirely.
    await scrollTo(harness, 2_500);
    expect(
      harness.rowsElement.querySelector('[data-row-index="5"]')
    ).toBeNull();
    // Scroll back: the re-rendered window must reproduce the selection.
    await scrollTo(harness, 0);
    expect(selectedIndexesInDom(harness)).toEqual([5, 6, 7, 8]);
    expect(harness.register.getSelection().indexes).toEqual(
      new Set([5, 6, 7, 8])
    );
    harness.cleanUp();
  });

  test('setSelectedRow(null) clears a range selection without firing callbacks', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    clickRow(harness, 5);
    clickRow(harness, 8, { shiftKey: true });
    const callbackCount = harness.selections.length;
    harness.register.setSelectedRow(null);
    expect(selectedIndexesInDom(harness)).toEqual([]);
    expect(harness.register.getSelection()).toEqual({
      anchor: null,
      indexes: new Set(),
    });
    expect(harness.selections.length).toBe(callbackCount);
    harness.cleanUp();
  });
});

describe('range mode with grouped rows', () => {
  test('group header rows are unselectable and shift-ranges span them in entry space', async () => {
    // 2 months × 100 rows: dates flip at entry index 100.
    const rows = makeRows(ROW_COUNT).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: index < 100 ? '2026-01-15' : '2026-02-15',
      },
    }));
    const harness = await createHarness({
      selectionMode: 'range',
      groupBy: 'month',
    });
    harness.register.setRows(rows);
    await wait(0);
    const groupRow = harness.rowsElement.querySelector('[data-group-row]');
    expect(groupRow).not.toBeNull();
    // Clicking a group header fires nothing and selects nothing.
    groupRow?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true })
    );
    expect(harness.selections.length).toBe(0);
    expect(harness.register.getSelection().indexes.size).toBe(0);
    // A shift-range is computed in entry-index space, so it is contiguous
    // over entries even though a group header sits between them in the DOM.
    clickRow(harness, 3);
    clickRow(harness, 6, { shiftKey: true });
    expect(selectedIndexesInDom(harness)).toEqual([3, 4, 5, 6]);
    expect(harness.selections[harness.selections.length - 1].indexes).toEqual([
      3, 4, 5, 6,
    ]);
    harness.cleanUp();
  });
});
