import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { LedgerView } from '../src/components/LedgerView';
import { JOURNALS_TAG_NAME } from '../src/constants';
import {
  dispatchKey,
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
const VIEWPORT_HEIGHT = 400;

interface Harness {
  view: LedgerView;
  scroller: HTMLElement;
  sections: HTMLElement[];
  shadowRoot: ShadowRoot;
  rowSelects: Array<{ account: string; index: number }>;
  cleanUp(): void;
}

// Three stacked sections (the middle one optionally empty) inside ONE shared
// scroller — the LedgerView shape the cross-section handoff must coordinate.
async function createHarness(
  rowCounts: readonly number[] = [10, 10, 10]
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const rowSelects: Array<{ account: string; index: number }> = [];
  const view = new LedgerView({
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    onRowSelect(account, _row, index) {
      rowSelects.push({ account, index });
    },
  });
  view.render({
    sections: rowCounts.map((count, index) => ({
      account: `Assets:Section-${index}`,
      rows: makeRows(count),
    })),
    container,
    parentNode: document.body,
  });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  if (shadowRoot == null || !(scroller instanceof HTMLElement)) {
    throw new Error('createHarness: ledger view skeleton missing');
  }
  const totalRows = rowCounts.reduce((sum, count) => sum + count, 0);
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: rowCounts.length * HEADER_HEIGHT + totalRows * LINE_HEIGHT,
  });
  await wait(0);
  const sections = Array.from(
    shadowRoot.querySelectorAll('[data-register]')
  ).filter((section): section is HTMLElement => {
    return section instanceof HTMLElement;
  });
  return {
    view,
    scroller,
    sections,
    shadowRoot,
    rowSelects,
    cleanUp() {
      view.cleanUp();
    },
  };
}

describe('cross-section keyboard focus handoff', () => {
  test('ArrowDown past the last row of a section moves to the next section', async () => {
    const harness = await createHarness();
    const [first, second] = harness.view.getRegisters();
    first.focusRow(9);
    await wait(0);
    dispatchKey(harness.sections[0], 'ArrowDown');
    // Focus left section 0 entirely and landed on section 1's first row.
    expect(first.getFocusedRow()).toBeNull();
    expect(second.getFocusedRow()).toBe(0);
    expect(harness.sections[0].hasAttribute('aria-activedescendant')).toBe(
      false
    );
    expect(
      harness.sections[1].getAttribute('aria-activedescendant')
    ).not.toBeNull();
    // DOM focus followed into the next section's grid, so the next
    // keystroke is handled there.
    expect(harness.shadowRoot.activeElement).toBe(harness.sections[1]);
    dispatchKey(harness.sections[1], 'ArrowDown');
    expect(second.getFocusedRow()).toBe(1);
    harness.cleanUp();
  });

  test('ArrowUp from the first row of a section moves to the previous section last row', async () => {
    const harness = await createHarness();
    const [first, second] = harness.view.getRegisters();
    second.focusRow(0);
    await wait(0);
    dispatchKey(harness.sections[1], 'ArrowUp');
    expect(second.getFocusedRow()).toBeNull();
    expect(first.getFocusedRow()).toBe(9);
    expect(harness.shadowRoot.activeElement).toBe(harness.sections[0]);
    harness.cleanUp();
  });

  test('empty sections are skipped in both directions', async () => {
    const harness = await createHarness([5, 0, 5]);
    const registers = harness.view.getRegisters();
    registers[0].focusRow(4);
    await wait(0);
    dispatchKey(harness.sections[0], 'ArrowDown');
    expect(registers[2].getFocusedRow()).toBe(0);
    dispatchKey(harness.sections[2], 'ArrowUp');
    expect(registers[2].getFocusedRow()).toBeNull();
    expect(registers[0].getFocusedRow()).toBe(4);
    harness.cleanUp();
  });

  test('arrows clamp at the ledger edges (no section to hand off to)', async () => {
    const harness = await createHarness();
    const registers = harness.view.getRegisters();
    registers[0].focusRow(0);
    await wait(0);
    dispatchKey(harness.sections[0], 'ArrowUp');
    expect(registers[0].getFocusedRow()).toBe(0);
    registers[2].focusRow(9);
    await wait(0);
    dispatchKey(harness.sections[2], 'ArrowDown');
    expect(registers[2].getFocusedRow()).toBe(9);
    harness.cleanUp();
  });

  test('selection coordination is unchanged: Enter in a new section clears the others', async () => {
    const harness = await createHarness();
    const registers = harness.view.getRegisters();
    registers[0].focusRow(3);
    await wait(0);
    dispatchKey(harness.sections[0], 'Enter');
    expect(registers[0].getSelectedRow()).toBe(3);
    // Hand off to section 1 and select there: section 0's selection must
    // clear (the ledger models one selected row across the document).
    registers[0].focusRow(9);
    await wait(0);
    dispatchKey(harness.sections[0], 'ArrowDown');
    dispatchKey(harness.sections[1], 'Enter');
    expect(registers[1].getSelectedRow()).toBe(0);
    expect(registers[0].getSelectedRow()).toBeNull();
    expect(harness.rowSelects).toEqual([
      { account: 'Assets:Section-0', index: 3 },
      { account: 'Assets:Section-1', index: 0 },
    ]);
    harness.cleanUp();
  });

  test('every section is its own grid with its own tab stop', async () => {
    const harness = await createHarness();
    for (const section of harness.sections) {
      expect(section.getAttribute('role')).toBe('grid');
      expect(section.getAttribute('tabindex')).toBe('0');
    }
    // Labels default to the section's account path.
    expect(harness.sections[1].getAttribute('aria-label')).toBe(
      'Assets:Section-1'
    );
    harness.cleanUp();
  });
});
