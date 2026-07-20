import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { RegisterFilterResult, RegisterRowData } from '../src/types';
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
const ROW_COUNT = 40;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + ROW_COUNT * LINE_HEIGHT;

interface Harness {
  register: Register;
  section: HTMLElement;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  filterResults: RegisterFilterResult[];
  cleanUp(): void;
}

// Compact-density harness with declared geometry (the aria/keyboard suites'
// shape) sized so a 40-row register renders fully within one window — every
// projection assertion can then read the whole DOM.
async function createHarness(
  options: Partial<RegisterOptions> = {},
  rows: readonly RegisterRowData[] = makeRows(ROW_COUNT),
  scrollHeight: number = SCROLL_HEIGHT
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const filterResults: RegisterFilterResult[] = [];
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    id: 'flt',
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
    onFilterResult(result) {
      filterResults.push(result);
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
  stubScrollerGeometry(scroller, { height: VIEWPORT_HEIGHT, scrollHeight });
  await wait(0);
  return {
    register,
    section,
    scroller,
    rowsElement,
    filterResults,
    cleanUp() {
      register.cleanUp();
    },
  };
}

function renderedIndexes(harness: Harness): number[] {
  return Array.from(harness.rowsElement.querySelectorAll('[data-row]')).map(
    (row) => Number(row.getAttribute('data-row-index'))
  );
}

// Rows with a few distinctive payees/narrations so substring queries have
// exact, hand-checkable match sets.
function makeSearchableRows(): RegisterRowData[] {
  return makeRows(ROW_COUNT).map((row, index) => {
    const entry = { ...row.entry };
    if (index === 2 || index === 5) {
      entry.payee = `Acme Sdn Bhd ${index}`;
    }
    if (index === 7) {
      entry.narration = 'coffee beans restock';
    }
    if (index === 9) {
      entry.flag = 'pending';
    }
    return { ...row, entry };
  });
}

describe('matching semantics', () => {
  test('default field is the description pair, case-insensitively', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: 'ACME' });
    expect(renderedIndexes(harness)).toEqual([2, 5]);
    // Narration matches through the same description field.
    harness.register.setFilter({ query: 'coffee' });
    expect(renderedIndexes(harness)).toEqual([7]);
    harness.cleanUp();
  });

  test('date and flag fields match when requested, not by default', async () => {
    const rows = makeSearchableRows().map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: index < 20 ? '2026-01-15' : '2026-02-15',
      },
    }));
    const harness = await createHarness({}, rows);
    // Default (description) field: a date query matches nothing.
    harness.register.setFilter({ query: '2026-02' });
    expect(renderedIndexes(harness)).toEqual([]);
    harness.register.setFilter({ query: '2026-02', fields: ['date'] });
    expect(renderedIndexes(harness)).toEqual(
      Array.from({ length: 20 }, (_, offset) => 20 + offset)
    );
    harness.register.setFilter({ query: 'pend', fields: ['flag'] });
    expect(renderedIndexes(harness)).toEqual([9]);
    // Multi-field: any field matching keeps the row.
    harness.register.setFilter({
      query: 'acme',
      fields: ['description', 'flag'],
    });
    expect(renderedIndexes(harness)).toEqual([2, 5]);
    harness.cleanUp();
  });

  test('queries never match across the payee/narration boundary', async () => {
    const rows = makeRows(3).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        payee: index === 1 ? 'Alpha' : row.entry.payee,
        narration: index === 1 ? 'Beta' : row.entry.narration,
      },
    }));
    const harness = await createHarness({}, rows);
    // 'alphabeta' would only match a concatenation; the corpus joins the
    // two lines with '\n' precisely so it cannot.
    harness.register.setFilter({ query: 'alphabeta' });
    expect(renderedIndexes(harness)).toEqual([]);
    harness.register.setFilter({ query: 'alpha' });
    expect(renderedIndexes(harness)).toEqual([1]);
    harness.cleanUp();
  });

  test('matching runs on raw text, never on escaped HTML', async () => {
    const rows = makeRows(3).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        payee: index === 1 ? 'Fish & Chips' : row.entry.payee,
      },
    }));
    const harness = await createHarness({}, rows);
    // The escaped form is 'Fish &amp; Chips'; matching the raw string means
    // 'amp' finds nothing.
    harness.register.setFilter({ query: 'amp' });
    expect(renderedIndexes(harness)).toEqual([]);
    harness.cleanUp();
  });
});

describe('filtered row model', () => {
  test('flat: matched rows only, full-data row indexes, filtered aria positions', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: 'acme' });
    const rows = Array.from(harness.rowsElement.querySelectorAll('[data-row]'));
    expect(rows.length).toBe(2);
    // data-row-index and ids stay FULL-data entry indexes (identity is
    // never renumbered by the projection)...
    expect(rows[0].getAttribute('data-row-index')).toBe('2');
    expect(rows[0].getAttribute('id')).toBe('flt-row-2');
    expect(rows[1].getAttribute('data-row-index')).toBe('5');
    // ...while aria-rowindex describes the PRESENTED grid: positions within
    // the filtered model.
    expect(rows[0].getAttribute('aria-rowindex')).toBe('1');
    expect(rows[1].getAttribute('aria-rowindex')).toBe('2');
    expect(harness.section.getAttribute('aria-rowcount')).toBe('2');
    harness.cleanUp();
  });

  test('grouped: empty periods drop and summaries recompute over matches', async () => {
    // 3 months × distinct payees: 'target' rows land in Jan (2) and Mar (1);
    // Feb holds no match and must lose its header entirely.
    const rows = makeRows(9).map((row, index) => {
      const month = Math.floor(index / 3) + 1;
      return {
        ...row,
        entry: {
          ...row.entry,
          date: `2026-0${month}-10`,
          payee: [0, 2, 6].includes(index) ? `target ${index}` : `other`,
        },
        posting: { ...row.posting, amount: 1_000 * (index + 1) },
      };
    });
    const harness = await createHarness(
      { groupBy: 'month' },
      rows,
      SCROLL_HEIGHT + 3 * 28
    );
    harness.register.setFilter({ query: 'target' });
    const groups = Array.from(
      harness.rowsElement.querySelectorAll('[data-group-row]')
    );
    expect(groups.map((group) => group.getAttribute('data-group-key'))).toEqual(
      ['2026-01', '2026-03']
    );
    // January: matched entries 0 and 2 → 2 entries, net 1000 + 3000 = 4000
    // minor units — the summary describes what's SHOWN, not the period's
    // full total.
    expect(groups[0].querySelector('[data-group-count]')?.textContent).toBe(
      '2 entries'
    );
    expect(groups[0].querySelector('[data-group-net]')?.textContent).toContain(
      '+40.00'
    );
    // March: matched entry 6 alone → 1 entry, net 7000.
    expect(groups[1].querySelector('[data-group-count]')?.textContent).toBe(
      '1 entry'
    );
    expect(groups[1].querySelector('[data-group-net]')?.textContent).toContain(
      '+70.00'
    );
    // Model = [Jan, e0, e2, Mar, e6] → aria-rowcount 5, entry positions
    // count the interleaved headers.
    expect(harness.section.getAttribute('aria-rowcount')).toBe('5');
    expect(renderedIndexes(harness)).toEqual([0, 2, 6]);
    expect(
      harness.rowsElement
        .querySelector('[data-row-index="6"]')
        ?.getAttribute('aria-rowindex')
    ).toBe('5');
    harness.cleanUp();
  });

  test('no matches renders an empty grid with aria-rowcount 0', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: 'no such payee anywhere' });
    expect(renderedIndexes(harness)).toEqual([]);
    expect(harness.section.getAttribute('aria-rowcount')).toBe('0');
    harness.cleanUp();
  });
});

describe('full-data index preservation', () => {
  test('selection survives filtering untouched; hidden selected rows just do not render', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setSelectedRow(5);
    harness.register.setFilter({ query: 'coffee' }); // Hides row 5.
    expect(harness.register.getSelectedRow()).toBe(5);
    expect(
      harness.rowsElement.querySelector('[data-row-index="5"]')
    ).toBeNull();
    // Releasing the filter re-renders the row still selected.
    harness.register.setFilter(null);
    expect(
      harness.rowsElement
        .querySelector('[data-row-index="5"]')
        ?.getAttribute('data-row-selected')
    ).toBe('true');
    harness.cleanUp();
  });

  test('scrollToRow targets the same entry before and after filtering', async () => {
    const rows = makeRows(200).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        payee: index % 10 === 0 ? `milestone ${index}` : row.entry.payee,
      },
    }));
    const harness = await createHarness(
      {},
      rows,
      HEADER_HEIGHT + 200 * LINE_HEIGHT
    );
    harness.register.setFilter({ query: 'milestone' }); // 20 matches.
    // Entry 100 is the 11th match (filtered position 10): its top is
    // 44 + 10 * 20 = 244 — already inside the 400px viewport, so 'start'
    // alignment scrolls to 244 − 44 = 200.
    harness.register.scrollToRow(100, { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(200);
    // A filtered-out entry keeps its identity but has no visible position:
    // graceful no-op.
    harness.register.scrollToRow(101, { align: 'start' });
    expect(harness.scroller.scrollTop).toBe(200);
    harness.cleanUp();
  });
});

describe('keyboard navigation over the filtered model', () => {
  test('arrows, Home and End walk matched rows only', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: 'acme' }); // Matches [2, 5].
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(2);
    dispatchKey(harness.section, 'ArrowDown');
    expect(harness.register.getFocusedRow()).toBe(5);
    dispatchKey(harness.section, 'ArrowDown'); // Clamps at the last match.
    expect(harness.register.getFocusedRow()).toBe(5);
    dispatchKey(harness.section, 'Home');
    expect(harness.register.getFocusedRow()).toBe(2);
    dispatchKey(harness.section, 'End');
    expect(harness.register.getFocusedRow()).toBe(5);
    expect(harness.section.getAttribute('aria-activedescendant')).toBe(
      'flt-row-5'
    );
    harness.cleanUp();
  });

  test('focus clears when the focused row gets filtered out', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.focusRow(7);
    expect(harness.section.getAttribute('aria-activedescendant')).toBe(
      'flt-row-7'
    );
    harness.register.setFilter({ query: 'acme' }); // Row 7 disappears.
    expect(harness.register.getFocusedRow()).toBeNull();
    expect(harness.section.hasAttribute('aria-activedescendant')).toBe(false);
    // focusRow on a hidden entry is a graceful no-op.
    harness.register.focusRow(7);
    expect(harness.register.getFocusedRow()).toBeNull();
    harness.cleanUp();
  });
});

describe('match highlighting', () => {
  test('matched substrings wrap in <mark data-filter-match>', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: 'acme' });
    const payee = harness.rowsElement.querySelector(
      '[data-row-index="2"] [data-payee]'
    );
    expect(payee?.innerHTML).toBe(
      '<mark data-filter-match="">Acme</mark> Sdn Bhd 2'
    );
    harness.cleanUp();
  });

  test('XSS attempt: <script> in the description escapes around exact mark boundaries', async () => {
    const rows = makeRows(3).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        payee: index === 1 ? '<script>alert(1)</script>' : row.entry.payee,
      },
    }));
    const harness = await createHarness({}, rows);
    harness.register.setFilter({ query: 'script' });
    expect(renderedIndexes(harness)).toEqual([1]);
    const payee = harness.rowsElement.querySelector(
      '[data-row-index="1"] [data-payee]'
    );
    // Slices escape SEPARATELY around the marks: no live <script> element
    // can ever materialize, and both occurrences highlight.
    expect(payee?.innerHTML).toBe(
      '&lt;<mark data-filter-match="">script</mark>&gt;alert(1)&lt;/<mark data-filter-match="">script</mark>&gt;'
    );
    expect(harness.rowsElement.querySelector('script')).toBeNull();
    harness.cleanUp();
  });

  test('date highlights only when the date field is filtered', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setFilter({ query: '2026', fields: ['date'] });
    const date = harness.rowsElement.querySelector(
      '[data-row-index="0"] [data-cell="date"]'
    );
    expect(date?.innerHTML).toBe(
      '<mark data-filter-match="">2026</mark>-07-18'
    );
    harness.cleanUp();
  });
});

describe('corpus reuse and invalidation', () => {
  test('the lowercase corpus is reused across query changes and dropped on a new rows reference', async () => {
    const rows = makeSearchableRows();
    const harness = await createHarness({}, rows);
    harness.register.setFilter({ query: 'acme' }); // Builds the corpus.
    expect(renderedIndexes(harness)).toEqual([2, 5]);
    // Mutate a row IN PLACE (no setRows): the cached corpus must keep
    // answering from the old text — behavioral proof of reuse.
    rows[3].entry.narration = 'zebra crossing';
    harness.register.setFilter({ query: 'zebra' });
    expect(renderedIndexes(harness)).toEqual([]);
    // Same-reference setRows is a no-op (the reference bail-out): the
    // corpus survives and keeps answering from the old text.
    harness.register.setRows(rows);
    expect(renderedIndexes(harness)).toEqual([]);
    // A NEW array reference is the data-change signal: it invalidates the
    // corpus and the same query now sees the mutated text.
    harness.register.setRows(rows.slice());
    expect(renderedIndexes(harness)).toEqual([3]);
    harness.cleanUp();
  });
});

describe('null and empty-query fast path', () => {
  test('clearing the filter restores byte-identical unfiltered window HTML', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    const baseline = harness.rowsElement.innerHTML;
    const baselineRowCount = harness.section.getAttribute('aria-rowcount');
    harness.register.setFilter({ query: 'acme' });
    expect(harness.rowsElement.innerHTML).not.toBe(baseline);
    harness.register.setFilter(null);
    expect(harness.rowsElement.innerHTML).toBe(baseline);
    expect(harness.section.getAttribute('aria-rowcount')).toBe(
      baselineRowCount
    );
    // An empty query IS "no filter": same bytes, no onFilterResult.
    const resultsBefore = harness.filterResults.length;
    harness.register.setFilter({ query: '' });
    expect(harness.rowsElement.innerHTML).toBe(baseline);
    expect(harness.filterResults.length).toBe(resultsBefore);
    harness.cleanUp();
  });
});

describe('onFilterResult', () => {
  test('fires with matched/total on application, refiltering, and setRows; never on clear', async () => {
    const rows = makeSearchableRows();
    const harness = await createHarness({}, rows);
    expect(harness.filterResults).toEqual([]);
    harness.register.setFilter({ query: 'acme' });
    expect(harness.filterResults).toEqual([{ matched: 2, total: ROW_COUNT }]);
    harness.register.setFilter({ query: 'coffee' });
    expect(harness.filterResults[1]).toEqual({
      matched: 1,
      total: ROW_COUNT,
    });
    // setRows re-applies the active filter to the new data.
    harness.register.setRows(rows.slice(0, 10));
    expect(harness.filterResults[2]).toEqual({ matched: 1, total: 10 });
    harness.register.setFilter(null);
    expect(harness.filterResults.length).toBe(3);
    harness.cleanUp();
  });

  test('setOptions with a new filter reference applies it like setFilter', async () => {
    const harness = await createHarness({}, makeSearchableRows());
    harness.register.setOptions({
      ...harness.register.options,
      filter: { query: 'acme' },
    });
    expect(renderedIndexes(harness)).toEqual([2, 5]);
    expect(harness.filterResults).toEqual([{ matched: 2, total: ROW_COUNT }]);
    harness.cleanUp();
  });
});
