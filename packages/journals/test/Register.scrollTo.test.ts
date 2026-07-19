import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { RegisterRowData } from '../src/types';
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

// Deterministic geometry (the virtualization-test conventions): compact
// density => rowHeight = LINE_HEIGHT, header 44, viewport 400.
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const GROUP_ROW_HEIGHT = LINE_HEIGHT + 8;
const VIEWPORT_HEIGHT = 400;

interface Harness {
  register: Register;
  scroller: HTMLElement;
  cleanUp(): void;
}

async function createHarness(
  rows: readonly RegisterRowData[],
  scrollHeight: number,
  groupBy: 'none' | 'month' = 'none'
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    groupBy,
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
  });
  register.render({ rows, container, parentNode: document.body });
  const scroller = container.shadowRoot?.querySelector('[data-scroller]');
  if (!(scroller instanceof HTMLElement)) {
    throw new Error('createHarness: register skeleton missing');
  }
  stubScrollerGeometry(scroller, { height: VIEWPORT_HEIGHT, scrollHeight });
  await wait(0);
  return {
    register,
    scroller,
    cleanUp() {
      register.cleanUp();
    },
  };
}

// Two months of rows so the grouped model carries two interleaved headers:
// entry row i sits at offset 28 + i*20 (i < 100) or 2056 + (i-100)*20.
function makeGroupedRows(count: number): RegisterRowData[] {
  return makeRows(count).map((row, index) => ({
    ...row,
    entry: {
      ...row.entry,
      date: index < 100 ? '2026-01-15' : '2026-02-15',
    },
  }));
}

const FLAT_ROW_COUNT = 1000;
const FLAT_SCROLL_HEIGHT = HEADER_HEIGHT + FLAT_ROW_COUNT * LINE_HEIGHT;
const GROUPED_ROW_COUNT = 200;
const GROUPED_SCROLL_HEIGHT =
  HEADER_HEIGHT + 2 * GROUP_ROW_HEIGHT + GROUPED_ROW_COUNT * LINE_HEIGHT;

describe('Register.scrollToRow (flat)', () => {
  test("align 'start' lands the row just below the sticky header", async () => {
    const harness = await createHarness(
      makeRows(FLAT_ROW_COUNT),
      FLAT_SCROLL_HEIGHT
    );
    harness.register.scrollToRow(500, { align: 'start' });
    // Row top = 44 + 500*20 = 10044; minus the sticky header overlay = 10000.
    expect(harness.scroller.scrollTop).toBe(10_000);
    // The default behavior is 'auto': the write is synchronous, and the
    // next frame re-windows around the new position.
    await wait(0);
    const range = harness.register.getRenderedRange();
    expect(range != null && range.start <= 500 && 500 < range.end).toBe(true);
    harness.cleanUp();
  });

  test("align 'center' centers the row in the viewport", async () => {
    const harness = await createHarness(
      makeRows(FLAT_ROW_COUNT),
      FLAT_SCROLL_HEIGHT
    );
    harness.register.scrollToRow(500, { align: 'center' });
    // rowTop + rowHeight/2 - viewport/2 = 10044 + 10 - 200.
    expect(harness.scroller.scrollTop).toBe(9854);
    harness.cleanUp();
  });

  test("align 'nearest' (default) bottom-aligns rows below and top-aligns rows above", async () => {
    const harness = await createHarness(
      makeRows(FLAT_ROW_COUNT),
      FLAT_SCROLL_HEIGHT
    );
    harness.register.scrollToRow(500);
    // Below the viewport: rowTop + rowHeight - viewport = 10044 + 20 - 400.
    expect(harness.scroller.scrollTop).toBe(9664);
    harness.register.scrollToRow(400);
    // Above: rowTop - headerHeight = 8044 - 44.
    expect(harness.scroller.scrollTop).toBe(8000);
    harness.cleanUp();
  });

  test("align 'nearest' is a no-op when the row is already fully visible", async () => {
    const harness = await createHarness(
      makeRows(FLAT_ROW_COUNT),
      FLAT_SCROLL_HEIGHT
    );
    harness.register.scrollToRow(500, { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(10_000);
    // Row 505 spans [10144, 10164): inside [10044, 10400] → no movement.
    harness.register.scrollToRow(505);
    expect(harness.scroller.scrollTop).toBe(10_000);
    harness.cleanUp();
  });

  test('targets clamp to the scrollable range and bad indexes are no-ops', async () => {
    const harness = await createHarness(
      makeRows(FLAT_ROW_COUNT),
      FLAT_SCROLL_HEIGHT
    );
    harness.register.scrollToRow(FLAT_ROW_COUNT - 1, { align: 'start' });
    // Raw target 19980 exceeds maxScrollTop = 20044 - 400 = 19644.
    expect(harness.scroller.scrollTop).toBe(19_644);
    harness.register.scrollToRow(FLAT_ROW_COUNT + 5, { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(19_644);
    harness.register.scrollToRow(-1, { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(19_644);
    harness.cleanUp();
  });
});

describe('Register.scrollToRow (grouped: prefix-sum targets)', () => {
  test('row targets fold in the interleaved group header heights', async () => {
    const harness = await createHarness(
      makeGroupedRows(GROUPED_ROW_COUNT),
      GROUPED_SCROLL_HEIGHT,
      'month'
    );
    harness.register.scrollToRow(150, { align: 'start' });
    // Entry 150: header 44 + group 28 + 100 rows + group 28 + 50 rows
    // = 44 + 3056 = 3100; minus the header overlay = 3056.
    expect(harness.scroller.scrollTop).toBe(3056);
    harness.register.scrollToRow(0, { align: 'start' });
    // Entry 0 sits below the first group header: 44 + 28 - 44 = 28.
    expect(harness.scroller.scrollTop).toBe(28);
    harness.cleanUp();
  });
});

describe('Register.scrollToDate', () => {
  test('scrolls to the first row dated on or after the target', async () => {
    const harness = await createHarness(
      makeGroupedRows(GROUPED_ROW_COUNT),
      GROUPED_SCROLL_HEIGHT,
      'month'
    );
    harness.register.scrollToDate('2026-02-01', { align: 'start' });
    // First February row is entry 100 at 44 + 28 + 2000 + 28 = 2100 → 2056.
    expect(harness.scroller.scrollTop).toBe(2056);
    // An exact-match date resolves to the same row.
    harness.register.scrollToDate('2026-02-15', { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(2056);
    harness.cleanUp();
  });

  test('dates before the first row resolve to row 0', async () => {
    const harness = await createHarness(
      makeGroupedRows(GROUPED_ROW_COUNT),
      GROUPED_SCROLL_HEIGHT,
      'month'
    );
    harness.register.scrollToRow(150, { align: 'start' });
    harness.register.scrollToDate('2025-01-01', { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(28);
    harness.cleanUp();
  });

  test('dates after the last row are a graceful no-op', async () => {
    const harness = await createHarness(
      makeGroupedRows(GROUPED_ROW_COUNT),
      GROUPED_SCROLL_HEIGHT,
      'month'
    );
    harness.register.scrollToRow(150, { align: 'start' });
    const before = harness.scroller.scrollTop;
    harness.register.scrollToDate('2027-01-01', { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(before);
    harness.cleanUp();
  });

  test('empty registers are a graceful no-op', async () => {
    const harness = await createHarness([], HEADER_HEIGHT);
    harness.register.scrollToDate('2026-01-01');
    harness.register.scrollToRow(0);
    expect(harness.scroller.scrollTop).toBe(0);
    harness.cleanUp();
  });
});
