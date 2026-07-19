import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { LedgerView } from '../src/components/LedgerView';
import { JOURNALS_TAG_NAME } from '../src/constants';
import {
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
  content: HTMLElement;
  cleanUp(): void;
}

async function createHarness(
  rowCounts: readonly number[] = [10, 10, 10]
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const view = new LedgerView({
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
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
  const content = shadowRoot?.querySelector('[data-journals-content]');
  if (!(scroller instanceof HTMLElement) || !(content instanceof HTMLElement)) {
    throw new Error('createHarness: ledger view skeleton missing');
  }
  const totalRows = rowCounts.reduce((sum, count) => sum + count, 0);
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: rowCounts.length * HEADER_HEIGHT + totalRows * LINE_HEIGHT,
  });
  await wait(0);
  return {
    view,
    scroller,
    content,
    cleanUp() {
      view.cleanUp();
    },
  };
}

function domSectionAccounts(content: HTMLElement): (string | null)[] {
  return Array.from(content.querySelectorAll('[data-register]')).map(
    (section) => section.getAttribute('aria-label')
  );
}

describe('LedgerView incremental setSections', () => {
  test('unchanged sections keep their Register instance AND their DOM', async () => {
    const harness = await createHarness();
    const registersBefore = harness.view.getRegisters();
    const sectionElementBefore = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-1"]'
    );
    const rowBefore = sectionElementBefore?.querySelector(
      '[data-row-index="3"]'
    );
    expect(rowBefore).not.toBeNull();

    // Fresh-but-structurally-equal rows (immutable-store snapshot shape):
    // reconciliation must treat them as unchanged.
    harness.view.setSections(
      [0, 1, 2].map((index) => ({
        account: `Assets:Section-${index}`,
        rows: makeRows(10),
      }))
    );
    await wait(0);
    const registersAfter = harness.view.getRegisters();
    expect(registersAfter.length).toBe(3);
    for (const [index, register] of registersAfter.entries()) {
      expect(register).toBe(registersBefore[index]);
    }
    // Node identity: the row DOM was not rewritten.
    expect(
      harness.content
        .querySelector('[data-register][aria-label="Assets:Section-1"]')
        ?.querySelector('[data-row-index="3"]')
    ).toBe(rowBefore as Element);
    harness.cleanUp();
  });

  test('data-changed sections update in place on the same instance', async () => {
    const harness = await createHarness();
    const [first, second] = harness.view.getRegisters();
    harness.view.setSections([
      { account: 'Assets:Section-0', rows: makeRows(10) },
      { account: 'Assets:Section-1', rows: makeRows(25) },
      { account: 'Assets:Section-2', rows: makeRows(10) },
    ]);
    await wait(0);
    const registersAfter = harness.view.getRegisters();
    expect(registersAfter[0]).toBe(first);
    expect(registersAfter[1]).toBe(second);
    const updated = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-1"]'
    );
    expect(updated?.getAttribute('aria-rowcount')).toBe('25');
    harness.cleanUp();
  });

  test('added sections mount, removed sections clean up and leave the DOM', async () => {
    const harness = await createHarness();
    const [, second] = harness.view.getRegisters();
    const removedElement = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-0"]'
    );
    expect(removedElement).not.toBeNull();

    harness.view.setSections([
      { account: 'Assets:Section-1', rows: makeRows(10) },
      { account: 'Assets:Section-2', rows: makeRows(10) },
      { account: 'Assets:Section-3', rows: makeRows(5) },
    ]);
    await wait(0);
    expect(domSectionAccounts(harness.content)).toEqual([
      'Assets:Section-1',
      'Assets:Section-2',
      'Assets:Section-3',
    ]);
    // The surviving instance carried over; the removed element left the DOM.
    expect(harness.view.getRegisters()[0]).toBe(second);
    expect(removedElement?.isConnected).toBe(false);
    // cleanUp emptied the removed register (rows reset, range cleared).
    expect(harness.view.getRegisters().length).toBe(3);
    harness.cleanUp();
  });

  test('order changes reorder DOM nodes without recreating instances', async () => {
    const harness = await createHarness();
    const [first, second, third] = harness.view.getRegisters();
    const elementBefore = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-2"]'
    );
    harness.view.setSections([
      { account: 'Assets:Section-2', rows: makeRows(10) },
      { account: 'Assets:Section-0', rows: makeRows(10) },
      { account: 'Assets:Section-1', rows: makeRows(10) },
    ]);
    await wait(0);
    expect(domSectionAccounts(harness.content)).toEqual([
      'Assets:Section-2',
      'Assets:Section-0',
      'Assets:Section-1',
    ]);
    const registersAfter = harness.view.getRegisters();
    expect(registersAfter[0]).toBe(third);
    expect(registersAfter[1]).toBe(first);
    expect(registersAfter[2]).toBe(second);
    // The element moved, not remounted.
    expect(
      harness.content.querySelector(
        '[data-register][aria-label="Assets:Section-2"]'
      )
    ).toBe(elementBefore as Element);
    harness.cleanUp();
  });

  test('focus and selection survive reconciliation when their section survives', async () => {
    const harness = await createHarness();
    const registers = harness.view.getRegisters();
    registers[1].focusRow(3);
    registers[1].setSelectedRow(3);
    await wait(0);

    // Reorder + resize a NEIGHBOR section; the focused section survives.
    harness.view.setSections([
      { account: 'Assets:Section-1', rows: makeRows(10) },
      { account: 'Assets:Section-2', rows: makeRows(30) },
      { account: 'Assets:Section-0', rows: makeRows(10) },
    ]);
    await wait(0);
    const focused = harness.view.getRegisters()[0];
    expect(focused).toBe(registers[1]);
    expect(focused.getFocusedRow()).toBe(3);
    expect(focused.getSelectedRow()).toBe(3);
    const section = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-1"]'
    );
    expect(
      section
        ?.querySelector('[data-row-index="3"]')
        ?.getAttribute('data-row-selected')
    ).toBe('true');
    harness.cleanUp();
  });

  test('cross-section handoff and selection coordination use the CURRENT order', async () => {
    const harness = await createHarness();
    // Reverse the sections, then verify the boundary walk follows the new
    // order (section 2 is now first; ArrowDown from its last row must land
    // on section 1's first row — the new middle).
    harness.view.setSections([
      { account: 'Assets:Section-2', rows: makeRows(10) },
      { account: 'Assets:Section-1', rows: makeRows(10) },
      { account: 'Assets:Section-0', rows: makeRows(10) },
    ]);
    await wait(0);
    const [reorderedFirst, reorderedSecond] = harness.view.getRegisters();
    reorderedFirst.focusRow(9);
    await wait(0);
    const firstSection = harness.content.querySelector(
      '[data-register][aria-label="Assets:Section-2"]'
    );
    firstSection?.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(reorderedFirst.getFocusedRow()).toBeNull();
    expect(reorderedSecond.getFocusedRow()).toBe(0);
    harness.cleanUp();
  });
});
