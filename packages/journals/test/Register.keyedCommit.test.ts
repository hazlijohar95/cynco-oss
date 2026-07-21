import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { renderRegisterRowsHTML } from '../src/renderers/RegisterRenderer';
import { commitRegisterRowsHTML } from '../src/utils/commitRegisterRowsHTML';
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

// Same deterministic geometry as the virtualization suite: compact density
// => rowHeight = LINE_HEIGHT, zero pixel overscroll, so windows derive
// purely from viewport + row overscan and the ranges below are exact.
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const OVERSCAN_ROWS = 10;
const ROW_COUNT = 1000;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + ROW_COUNT * LINE_HEIGHT;

interface Harness {
  register: Register;
  scroller: HTMLElement;
  section: HTMLElement;
  rowsElement: HTMLElement;
  rows: ReturnType<typeof makeRows>;
  cleanUp(): void;
}

async function createHarness(): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: OVERSCAN_ROWS,
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
  });
  const rows = makeRows(ROW_COUNT);
  register.render({ rows, container, parentNode: document.body });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const section = shadowRoot?.querySelector('[data-register]');
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  if (
    !(scroller instanceof HTMLElement) ||
    !(section instanceof HTMLElement) ||
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
    section,
    rowsElement,
    rows,
    cleanUp() {
      register.cleanUp();
    },
  };
}

async function scrollTo(harness: Harness, scrollTop: number): Promise<void> {
  harness.scroller.scrollTop = scrollTop;
  dispatchScroll(harness.scroller);
  await wait(0);
}

function captureRowElements(rowsElement: HTMLElement): Map<number, Element> {
  const byIndex = new Map<number, Element>();
  for (const row of rowsElement.querySelectorAll('[data-row]')) {
    byIndex.set(Number(row.getAttribute('data-row-index')), row);
  }
  return byIndex;
}

function getRenderedIndices(rowsElement: HTMLElement): number[] {
  return Array.from(rowsElement.querySelectorAll('[data-row]')).map((row) =>
    Number(row.getAttribute('data-row-index'))
  );
}

describe('commitRegisterRowsHTML (unit)', () => {
  const rows = makeRows(40);

  function renderInto(host: HTMLElement, start: number, end: number): void {
    host.innerHTML = renderRegisterRowsHTML(rows, { start, end }, null, 'k');
  }

  test('an empty container takes the wholesale-rewrite fast path', () => {
    const host = document.createElement('div');
    const html = renderRegisterRowsHTML(rows, { start: 0, end: 5 }, null, 'k');
    expect(commitRegisterRowsHTML(host, html)).toBe('replace');
    expect(host.children.length).toBe(5);
  });

  test('fully disjoint windows take the wholesale-rewrite fast path', () => {
    const host = document.createElement('div');
    renderInto(host, 0, 5);
    const before = host.querySelector('[data-row-index="0"]');
    const html = renderRegisterRowsHTML(
      rows,
      { start: 20, end: 25 },
      null,
      'k'
    );
    expect(commitRegisterRowsHTML(host, html)).toBe('replace');
    expect(before?.isConnected).toBe(false);
    expect(getRenderedIndices(host)).toEqual([20, 21, 22, 23, 24]);
  });

  test('overlapping windows morph: unchanged keys keep their elements', () => {
    const host = document.createElement('div');
    renderInto(host, 0, 10);
    const captured = captureRowElements(host);
    const html = renderRegisterRowsHTML(rows, { start: 5, end: 15 }, null, 'k');
    expect(commitRegisterRowsHTML(host, html)).toBe('morph');
    expect(getRenderedIndices(host)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    for (let index = 5; index < 10; index += 1) {
      expect(host.querySelector(`[data-row-index="${index}"]`)).toBe(
        captured.get(index) as Element
      );
    }
    // Evicted rows left the DOM entirely.
    expect(captured.get(0)?.isConnected).toBe(false);
    // The serialized result is byte-identical to a wholesale write — the
    // morph is a commit strategy, never a rendering one.
    const reference = document.createElement('div');
    reference.innerHTML = html;
    expect(host.innerHTML).toBe(reference.innerHTML);
  });

  test('a row whose bytes changed is replaced; identical siblings survive', () => {
    const host = document.createElement('div');
    renderInto(host, 0, 6);
    const captured = captureRowElements(host);
    // Same window, one row now rendered selected: only that element may be
    // rebuilt.
    const html = renderRegisterRowsHTML(
      rows,
      { start: 0, end: 6 },
      new Set([3]),
      'k'
    );
    expect(commitRegisterRowsHTML(host, html)).toBe('morph');
    expect(host.querySelector('[data-row-index="3"]')).not.toBe(
      captured.get(3) as Element
    );
    expect(
      host
        .querySelector('[data-row-index="3"]')
        ?.getAttribute('data-row-selected')
    ).toBe('true');
    for (const index of [0, 1, 2, 4, 5]) {
      expect(host.querySelector(`[data-row-index="${index}"]`)).toBe(
        captured.get(index) as Element
      );
    }
  });

  test('data-focused and data-hovered never break reuse (patched post-commit)', () => {
    const host = document.createElement('div');
    renderInto(host, 0, 4);
    const focused = host.querySelector('[data-row-index="1"]');
    const hovered = host.querySelector('[data-row-index="2"]');
    focused?.setAttribute('data-focused', 'true');
    hovered?.setAttribute('data-hovered', '');
    const html = renderRegisterRowsHTML(rows, { start: 0, end: 4 }, null, 'k');
    expect(commitRegisterRowsHTML(host, html)).toBe('morph');
    expect(host.querySelector('[data-row-index="1"]')).toBe(focused as Element);
    expect(host.querySelector('[data-row-index="2"]')).toBe(hovered as Element);
    // The reused elements keep the live-patched attributes.
    expect(focused?.getAttribute('data-focused')).toBe('true');
    expect(hovered?.hasAttribute('data-hovered')).toBe(true);
  });
});

describe('Register keyed window commits', () => {
  test('overlapping scroll reuses elements for surviving rows and replaces the rest', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 10_000); // window [487, 528)
    const captured = captureRowElements(harness.rowsElement);
    await scrollTo(harness, 10_100); // window [492, 533) — overlap [492, 528)
    expect(harness.register.getRenderedRange()).toEqual({
      start: 492,
      end: 533,
    });
    for (let index = 492; index < 528; index += 1) {
      expect(
        harness.rowsElement.querySelector(`[data-row-index="${index}"]`)
      ).toBe(captured.get(index) as Element);
    }
    // Evicted rows are gone; freshly entered rows exist and are new.
    for (let index = 487; index < 492; index += 1) {
      expect(captured.get(index)?.isConnected).toBe(false);
    }
    expect(getRenderedIndices(harness.rowsElement)).toEqual(
      Array.from({ length: 533 - 492 }, (_, offset) => 492 + offset)
    );
    harness.cleanUp();
  });

  test('a long scroll jump (disjoint windows) rewrites wholesale but stays correct', async () => {
    const harness = await createHarness();
    const rowBefore = harness.rowsElement.querySelector('[data-row-index="0"]');
    expect(rowBefore).not.toBeNull();
    await scrollTo(harness, 10_000); // [0, 28) → [487, 528): zero overlap
    expect(rowBefore?.isConnected).toBe(false);
    expect(getRenderedIndices(harness.rowsElement)).toEqual(
      Array.from({ length: 528 - 487 }, (_, offset) => 487 + offset)
    );
    harness.cleanUp();
  });

  test('setRows replaces only the rows whose bytes changed', async () => {
    const harness = await createHarness();
    const captured = captureRowElements(harness.rowsElement);
    expect(captured.size).toBe(28); // window [0, 28) at the top
    const nextRows = harness.rows.slice();
    nextRows[5] = {
      ...nextRows[5],
      entry: { ...nextRows[5].entry, narration: 'Edited narration' },
    };
    harness.register.setRows(nextRows);
    await wait(0);
    const after = captureRowElements(harness.rowsElement);
    expect(after.get(5)).not.toBe(captured.get(5) as Element);
    expect(after.get(5)?.querySelector('[data-narration]')?.textContent).toBe(
      'Edited narration'
    );
    for (const [index, element] of captured) {
      if (index !== 5) {
        expect(after.get(index)).toBe(element);
      }
    }
    harness.cleanUp();
  });

  test('the focused row survives an overlapping commit with focus state intact', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 10_000);
    harness.register.focusRow(500);
    const focusedBefore = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(focusedBefore?.getAttribute('data-focused')).toBe('true');
    const descendantBefore = harness.section.getAttribute(
      'aria-activedescendant'
    );
    expect(descendantBefore).not.toBeNull();
    await scrollTo(harness, 10_100);
    const focusedAfter = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(focusedAfter).toBe(focusedBefore as Element);
    expect(focusedAfter?.getAttribute('data-focused')).toBe('true');
    expect(harness.section.getAttribute('aria-activedescendant')).toBe(
      descendantBefore as string
    );
    harness.cleanUp();
  });

  test('live selection patches compose with keyed reuse and with re-entry', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 10_000);
    harness.register.setSelectedRow(500);
    const selectedBefore = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(selectedBefore?.getAttribute('data-row-selected')).toBe('true');
    // Overlapping commit: the live-patched element serializes exactly like
    // the renderer's selected bytes, so it is REUSED, not rebuilt.
    await scrollTo(harness, 10_100);
    const selectedAfter = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(selectedAfter).toBe(selectedBefore as Element);
    expect(selectedAfter?.getAttribute('aria-selected')).toBe('true');
    // Evict the row entirely, then bring it back: the re-entering element is
    // new (the old one was destroyed) but carries the selection baked in.
    await scrollTo(harness, 0);
    expect(selectedBefore?.isConnected).toBe(false);
    await scrollTo(harness, 10_000);
    const reentered = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(reentered).not.toBeNull();
    expect(reentered?.getAttribute('data-row-selected')).toBe('true');
    expect(reentered?.getAttribute('aria-selected')).toBe('true');
    harness.cleanUp();
  });
});
