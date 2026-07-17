import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
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

// Deterministic geometry: compact density => rowHeight = LINE_HEIGHT,
// zero pixel overscroll so windows derive purely from viewport + row overscan.
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const OVERSCAN_ROWS = 10;
const ROW_COUNT = 1000;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + ROW_COUNT * LINE_HEIGHT;

interface Harness {
  register: Register;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  spacerBefore: HTMLElement;
  spacerAfter: HTMLElement;
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
  register.render({
    rows: makeRows(ROW_COUNT),
    container,
    parentNode: document.body,
  });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  const spacerBefore = shadowRoot?.querySelector(
    '[data-register-spacer="before"]'
  );
  const spacerAfter = shadowRoot?.querySelector(
    '[data-register-spacer="after"]'
  );
  if (
    !(scroller instanceof HTMLElement) ||
    !(rowsElement instanceof HTMLElement) ||
    !(spacerBefore instanceof HTMLElement) ||
    !(spacerAfter instanceof HTMLElement)
  ) {
    throw new Error('createHarness: register skeleton missing');
  }
  // jsdom performs no layout; declare the scroll geometry the Virtualizer
  // reads before the first rAF-scheduled render pass runs.
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: SCROLL_HEIGHT,
  });
  await wait(0);
  return {
    register,
    scroller,
    rowsElement,
    spacerBefore,
    spacerAfter,
    cleanUp() {
      register.cleanUp();
    },
  };
}

function getRenderedIndices(rowsElement: HTMLElement): number[] {
  return Array.from(rowsElement.querySelectorAll('[data-row]')).map((row) =>
    Number(row.getAttribute('data-row-index'))
  );
}

async function scrollTo(harness: Harness, scrollTop: number): Promise<void> {
  harness.scroller.scrollTop = scrollTop;
  dispatchScroll(harness.scroller);
  await wait(0);
}

describe('Register virtualization window math', () => {
  test('top of scroll: window starts at row 0 with a zero before-spacer', async () => {
    const harness = await createHarness();
    // Window = [0, 400]; body starts at 44. Last visible row index is
    // ceil((400 - 44) / 20) = 18, plus 10 overscan rows => end 28.
    expect(harness.register.getRenderedRange()).toEqual({ start: 0, end: 28 });
    const indices = getRenderedIndices(harness.rowsElement);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(27);
    expect(indices.length).toBe(28);
    expect(harness.spacerBefore.style.height).toBe('0px');
    expect(harness.spacerAfter.style.height).toBe(
      `${(ROW_COUNT - 28) * LINE_HEIGHT}px`
    );
    harness.cleanUp();
  });

  test('middle of scroll: window centers on the viewport with overscan both sides', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 10_000);
    // Window = [10000, 10400]; start = floor((10000 - 44) / 20) - 10 = 487,
    // end = ceil((10400 - 44) / 20) + 10 = 528.
    expect(harness.register.getRenderedRange()).toEqual({
      start: 487,
      end: 528,
    });
    const indices = getRenderedIndices(harness.rowsElement);
    expect(indices[0]).toBe(487);
    expect(indices[indices.length - 1]).toBe(527);
    expect(harness.spacerBefore.style.height).toBe(`${487 * LINE_HEIGHT}px`);
    expect(harness.spacerAfter.style.height).toBe(
      `${(ROW_COUNT - 528) * LINE_HEIGHT}px`
    );
    harness.cleanUp();
  });

  test('bottom of scroll: window ends at the last row with a zero after-spacer', async () => {
    const harness = await createHarness();
    const maxScrollTop = SCROLL_HEIGHT - VIEWPORT_HEIGHT;
    await scrollTo(harness, maxScrollTop);
    // Window = [19644, 20044]; start = floor((19644 - 44) / 20) - 10 = 970,
    // end clamps to rowCount.
    expect(harness.register.getRenderedRange()).toEqual({
      start: 970,
      end: ROW_COUNT,
    });
    const indices = getRenderedIndices(harness.rowsElement);
    expect(indices[0]).toBe(970);
    expect(indices[indices.length - 1]).toBe(ROW_COUNT - 1);
    expect(harness.spacerBefore.style.height).toBe(`${970 * LINE_HEIGHT}px`);
    expect(harness.spacerAfter.style.height).toBe('0px');
    harness.cleanUp();
  });

  test('scrolling without crossing a row boundary keeps the same DOM nodes', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 10_000);
    const rowBefore = harness.rowsElement.querySelector(
      '[data-row-index="500"]'
    );
    expect(rowBefore).not.toBeNull();
    // A 3px scroll stays within the same 20px row bucket, so the range is
    // unchanged and the window must not be rewritten (same node identity).
    await scrollTo(harness, 10_003);
    expect(harness.register.getRenderedRange()).toEqual({
      start: 487,
      end: 528,
    });
    expect(harness.rowsElement.querySelector('[data-row-index="500"]')).toBe(
      rowBefore as HTMLElement
    );
    harness.cleanUp();
  });

  test('over-scroll clamps: scrollTop past the end never produces an out-of-range window', async () => {
    const harness = await createHarness();
    await scrollTo(harness, SCROLL_HEIGHT * 2);
    const range = harness.register.getRenderedRange();
    expect(range?.end).toBe(ROW_COUNT);
    expect(range != null && range.start <= range.end).toBe(true);
    harness.cleanUp();
  });
});
