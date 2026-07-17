import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME, DENSITY_ROW_HEIGHTS } from '../src/constants';
import { AccountTreeController } from '../src/model/AccountTreeController';
import { AccountTree } from '../src/render/AccountTree';
import {
  dispatchScroll,
  type DomHandle,
  installDom,
  makeWideChart,
  stubScrollerGeometry,
} from './domHarness';

let dom: DomHandle;
let tree: AccountTree | undefined;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

afterEach(() => {
  tree?.cleanUp();
  tree = undefined;
});

// 20 tops × 50 leaves → 20 groups + 1000 leaves = 1020 visible rows expanded.
const WIDE_CHART = makeWideChart(20, 50);
const WIDE_ROW_COUNT = 1020;

describe('getVisibleRange', () => {
  test('row heights follow the density presets', () => {
    for (const density of ['compact', 'default', 'relaxed'] as const) {
      const controller = new AccountTreeController({
        accounts: WIDE_CHART,
        density,
      });
      expect(controller.getRowHeight()).toBe(DENSITY_ROW_HEIGHTS[density]);
      expect(controller.getTotalHeight()).toBe(
        WIDE_ROW_COUNT * DENSITY_ROW_HEIGHTS[density]
      );
    }
  });

  test('window math at default density (30px rows)', () => {
    const controller = new AccountTreeController({ accounts: WIDE_CHART });
    // scrollTop 900 → first visible row 30; viewport 300 → last row 39.
    expect(controller.getVisibleRange(900, 300)).toEqual({
      start: 20,
      end: 50,
    });
    // Overscan clamps at the edges.
    expect(controller.getVisibleRange(0, 300)).toEqual({ start: 0, end: 20 });
    expect(controller.getVisibleRange(WIDE_ROW_COUNT * 30 - 300, 300)).toEqual({
      start: WIDE_ROW_COUNT - 20,
      end: WIDE_ROW_COUNT,
    });
  });

  test('window math at compact density (24px rows) with custom overscan', () => {
    const controller = new AccountTreeController({
      accounts: WIDE_CHART,
      density: 'compact',
    });
    // scrollTop 240 → first row 10; viewport 240 → rows 10..19; overscan 5.
    expect(controller.getVisibleRange(240, 240, 5)).toEqual({
      start: 5,
      end: 25,
    });
  });

  test('empty trees and zero viewports produce empty ranges', () => {
    const controller = new AccountTreeController({});
    expect(controller.getVisibleRange(0, 300)).toEqual({ start: 0, end: 0 });
    const wide = new AccountTreeController({ accounts: WIDE_CHART });
    expect(wide.getVisibleRange(100, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('windowed rendering', () => {
  interface Mounted {
    tree: AccountTree;
    scroller: HTMLElement;
    rows: HTMLElement;
    spacerBefore: HTMLElement;
    spacerAfter: HTMLElement;
  }

  function mountWideTree(): Mounted {
    const mounted = new AccountTree({
      accounts: WIDE_CHART,
      overscanRows: 10,
    });
    mounted.render(document.body);
    tree = mounted;
    const shadowRoot =
      document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
    const scroller = shadowRoot?.querySelector('[data-scroller]');
    const rows = shadowRoot?.querySelector('[data-rows]');
    const spacerBefore = shadowRoot?.querySelector('[data-spacer="before"]');
    const spacerAfter = shadowRoot?.querySelector('[data-spacer="after"]');
    if (
      !(scroller instanceof HTMLElement) ||
      !(rows instanceof HTMLElement) ||
      !(spacerBefore instanceof HTMLElement) ||
      !(spacerAfter instanceof HTMLElement)
    ) {
      throw new Error('mountWideTree: shell missing');
    }
    stubScrollerGeometry(scroller, {
      height: 300,
      scrollHeight: WIDE_ROW_COUNT * 30,
    });
    // Re-window now that the stubbed viewport height is measurable.
    dispatchScroll(scroller);
    return { tree: mounted, scroller, rows, spacerBefore, spacerAfter };
  }

  test('renders only the window plus overscan, with exact spacer heights', () => {
    const {
      tree: mounted,
      scroller,
      rows,
      spacerBefore,
      spacerAfter,
    } = mountWideTree();
    scroller.scrollTop = 3_000; // Row 100 at the top; viewport rows 100..109.
    dispatchScroll(scroller);

    expect(mounted.getRenderedRange()).toEqual({ start: 90, end: 120 });
    expect(rows.querySelectorAll('[data-row]').length).toBe(30);
    expect(spacerBefore.style.height).toBe(`${90 * 30}px`);
    expect(spacerAfter.style.height).toBe(`${(WIDE_ROW_COUNT - 120) * 30}px`);
    // Absolute indices survive windowing.
    expect(rows.firstElementChild?.getAttribute('data-row-index')).toBe('90');
  });

  test('an unchanged range is a no-op; scrolling far re-windows', () => {
    const { tree: mounted, scroller, rows } = mountWideTree();
    scroller.scrollTop = 3_000;
    dispatchScroll(scroller);
    const firstRow = rows.firstElementChild;
    // A one-pixel scroll keeps the same row range: node identity preserved.
    scroller.scrollTop = 3_001;
    dispatchScroll(scroller);
    expect(rows.firstElementChild).toBe(firstRow);

    scroller.scrollTop = 12_000;
    dispatchScroll(scroller);
    expect(mounted.getRenderedRange()).toEqual({ start: 390, end: 420 });
  });

  test('collapsing from the tree API force-rebuilds the window and spacers', () => {
    const { tree: mounted, spacerAfter } = mountWideTree();
    mounted.collapseAll();
    // Only the 20 top-level groups remain: everything fits in the window.
    expect(mounted.getRenderedRange()?.start).toBe(0);
    expect(spacerAfter.style.height).toBe('0px');
    mounted.expandAll();
    expect(mounted.getRenderedRange()).toEqual({ start: 0, end: 20 });
  });

  test('sticky header mirrors the nearest off-screen ancestor group', () => {
    const { scroller } = mountWideTree();
    const shadowRoot =
      document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
    const sticky = shadowRoot?.querySelector('[data-sticky-header]');
    if (!(sticky instanceof HTMLElement)) {
      throw new Error('sticky header missing');
    }
    expect(sticky.hidden).toBe(true);

    // Row 10 at the top is a leaf inside T00 → the mirror shows T00.
    scroller.scrollTop = 300;
    dispatchScroll(scroller);
    expect(sticky.hidden).toBe(false);
    expect(sticky.querySelector('[data-name]')?.textContent).toBe('T00');
    expect(
      sticky.querySelector('[data-row]')?.getAttribute('aria-hidden')
    ).toBe('true');

    scroller.scrollTop = 0;
    dispatchScroll(scroller);
    expect(sticky.hidden).toBe(true);
  });
});
