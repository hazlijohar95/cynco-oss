import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { type LedgerSection, LedgerView } from '../src/components/LedgerView';
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

// Compact density: section height = HEADER + rows * LINE. Baseline
// [50, 50, 50] puts section tops at 0 / 1044 / 2088.
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const VIEWPORT_HEIGHT = 400;

function sections(counts: readonly [string, number][]): LedgerSection[] {
  return counts.map(([account, count]) => ({ account, rows: makeRows(count) }));
}

interface Harness {
  view: LedgerView;
  scroller: HTMLElement;
  cleanUp(): void;
}

async function createHarness(): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const view = new LedgerView({
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
  });
  view.render({
    sections: sections([
      ['Assets:A', 50],
      ['Assets:B', 50],
      ['Assets:C', 50],
    ]),
    container,
    parentNode: document.body,
  });
  const scroller = container.shadowRoot?.querySelector('[data-scroller]');
  if (!(scroller instanceof HTMLElement)) {
    throw new Error('createHarness: ledger view skeleton missing');
  }
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: 3 * HEADER_HEIGHT + 150 * LINE_HEIGHT,
  });
  await wait(0);
  return {
    view,
    scroller,
    cleanUp() {
      view.cleanUp();
    },
  };
}

// Anchor used by most tests: scrollTop 1300 puts section B's entry row 10
// (top 1044 + 44 + 200 = 1288) 12px above the viewport top.
const ANCHOR_SCROLL_TOP = 1300;

describe('LedgerView scroll anchoring across setSections', () => {
  test('anchor holds when a section above GROWS', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = ANCHOR_SCROLL_TOP;
    harness.view.setSections(
      sections([
        ['Assets:A', 80],
        ['Assets:B', 50],
        ['Assets:C', 50],
      ])
    );
    // B's top moved 1044 → 1644; anchor row 10 now at 1888, restored 12px
    // above the viewport top: 1888 + 12.
    expect(harness.scroller.scrollTop).toBe(1900);
    harness.cleanUp();
  });

  test('anchor holds when a section above SHRINKS', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = ANCHOR_SCROLL_TOP;
    harness.view.setSections(
      sections([
        ['Assets:A', 20],
        ['Assets:B', 50],
        ['Assets:C', 50],
      ])
    );
    // B's top moved to 444; anchor row 10 at 688, +12px offset = 700.
    expect(harness.scroller.scrollTop).toBe(700);
    harness.cleanUp();
  });

  test('anchor holds when sections are ADDED above', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = ANCHOR_SCROLL_TOP;
    harness.view.setSections(
      sections([
        ['Assets:New', 30],
        ['Assets:A', 50],
        ['Assets:B', 50],
        ['Assets:C', 50],
      ])
    );
    // New section adds 44 + 600 = 644 above; B top = 1688, row 10 at 1932.
    expect(harness.scroller.scrollTop).toBe(1944);
    harness.cleanUp();
  });

  test('anchor holds when sections are REMOVED above', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = ANCHOR_SCROLL_TOP;
    harness.view.setSections(
      sections([
        ['Assets:B', 50],
        ['Assets:C', 50],
      ])
    );
    // B now starts at 0; row 10 at 244, +12px offset = 256.
    expect(harness.scroller.scrollTop).toBe(256);
    harness.cleanUp();
  });

  test('anchor entry index clamps when the anchor section shrinks below it', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = ANCHOR_SCROLL_TOP; // Row 10 of B.
    harness.view.setSections(
      sections([
        ['Assets:A', 50],
        ['Assets:B', 5],
        ['Assets:C', 50],
      ])
    );
    // B keeps its top (1044) but row 10 no longer exists → clamp to row 4:
    // 1044 + 44 + 80 = 1168, +12px viewport offset = 1180.
    expect(harness.scroller.scrollTop).toBe(1180);
    harness.cleanUp();
  });

  test('header-band anchors (no entry row at the top) restore to the section top', async () => {
    const harness = await createHarness();
    // 1050 sits inside B's header band [1044, 1088): entryIndex is null and
    // the section top itself is the anchor (viewportOffset -6).
    harness.scroller.scrollTop = 1050;
    harness.view.setSections(
      sections([
        ['Assets:A', 80],
        ['Assets:B', 50],
        ['Assets:C', 50],
      ])
    );
    expect(harness.scroller.scrollTop).toBe(1650);
    harness.cleanUp();
  });

  describe('fallback ladder when the anchor section is removed', () => {
    test('rung 2: nearest PRECEDING survivor takes the removed section top position', async () => {
      const harness = await createHarness();
      harness.scroller.scrollTop = ANCHOR_SCROLL_TOP; // Anchored in B.
      harness.view.setSections(
        sections([
          ['Assets:A', 50],
          ['Assets:C', 50],
        ])
      );
      // B's old top sat 256px ABOVE the viewport top (1044 - 1300). A's new
      // bottom (1044) takes that position: 1044 + 256 = 1300.
      expect(harness.scroller.scrollTop).toBe(1300);
      harness.cleanUp();
    });

    test('rung 3: only a FOLLOWING survivor — its top takes the removed section top position', async () => {
      const harness = await createHarness();
      harness.scroller.scrollTop = ANCHOR_SCROLL_TOP; // Anchored in B.
      harness.view.setSections(sections([['Assets:C', 50]]));
      // C's new top (0) takes B's old viewport position: 0 + 256 = 256.
      expect(harness.scroller.scrollTop).toBe(256);
      harness.cleanUp();
    });

    test('rung 4: nothing survives — raw scrollTop is preserved (v1 behavior)', async () => {
      const harness = await createHarness();
      harness.scroller.scrollTop = ANCHOR_SCROLL_TOP;
      harness.view.setSections(sections([['Assets:Z', 200]]));
      expect(harness.scroller.scrollTop).toBe(ANCHOR_SCROLL_TOP);
      harness.cleanUp();
    });
  });
});
