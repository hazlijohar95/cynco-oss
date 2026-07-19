import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { GROUP_HEADER_EXTRA_HEIGHT, JOURNALS_TAG_NAME } from '../src/constants';
import type { MinorUnits, RegisterRowData } from '../src/types';
import { buildRegisterRowModel } from '../src/utils/buildRegisterRowModel';
import { computeGroupedRowWindow } from '../src/utils/computeGroupedRowWindow';
import { computeRowModelOffsets } from '../src/utils/computeRowModelOffsets';
import { formatPeriodLabel } from '../src/utils/formatPeriodLabel';
import {
  dispatchScroll,
  type DomHandle,
  installDom,
  makeEntry,
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

// Register rows with caller-controlled dates/amounts (date-sorted input is
// the data layer's contract, so fixtures are built pre-sorted).
function makeDatedRows(
  specs: readonly { date: string; amount: MinorUnits; currency?: string }[]
): RegisterRowData[] {
  let balance = 0;
  return specs.map((spec, index) => {
    balance += spec.amount;
    const currency = spec.currency ?? 'MYR';
    const entry = makeEntry({
      id: `entry-${index}`,
      date: spec.date,
      payee: `Payee ${index}`,
      narration: `Narration ${index}`,
      tags: [],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: spec.amount,
          currency,
        },
        { account: 'Income:Sales:Consulting', amount: -spec.amount, currency },
      ],
    });
    return {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([[currency, balance]]),
    };
  });
}

describe('formatPeriodLabel', () => {
  test('formats month, quarter, and year keys as deterministic English', () => {
    expect(formatPeriodLabel('2026-03')).toBe('March 2026');
    expect(formatPeriodLabel('2026-Q1')).toBe('Q1 2026');
    expect(formatPeriodLabel('2026')).toBe('2026');
  });

  test('malformed keys fall back to the key itself', () => {
    expect(formatPeriodLabel('2026-13')).toBe('2026-13');
    expect(formatPeriodLabel('garbage')).toBe('garbage');
  });
});

describe('buildRegisterRowModel', () => {
  const rows = makeDatedRows([
    { date: '2026-01-10', amount: 10_000 },
    { date: '2026-01-20', amount: -2_500 },
    { date: '2026-03-31', amount: 5_000 },
    { date: '2026-04-01', amount: 100, currency: 'USD' },
    { date: '2027-01-01', amount: 7_000 },
  ]);

  test('month grouping: boundaries at month changes, entry indexes preserved', () => {
    const model = buildRegisterRowModel(rows, 'month');
    expect(
      model.map((item) =>
        item.kind === 'group' ? `g:${item.group.key}` : `e:${item.entryIndex}`
      )
    ).toEqual([
      'g:2026-01',
      'e:0',
      'e:1',
      'g:2026-03',
      'e:2',
      'g:2026-04',
      'e:3',
      'g:2027-01',
      'e:4',
    ]);
    const january = model[0];
    if (january.kind !== 'group') throw new Error('expected group');
    expect(january.group.label).toBe('January 2026');
    expect(january.group.entryCount).toBe(2);
  });

  test('quarter grouping derives Q boundaries from month arithmetic', () => {
    const model = buildRegisterRowModel(rows, 'quarter');
    expect(
      model
        .filter((item) => item.kind === 'group')
        .map((item) => (item.kind === 'group' ? item.group.key : ''))
    ).toEqual(['2026-Q1', '2026-Q2', '2027-Q1']);
    const q1 = model[0];
    if (q1.kind !== 'group') throw new Error('expected group');
    expect(q1.group.label).toBe('Q1 2026');
    expect(q1.group.entryCount).toBe(3);
  });

  test('year grouping and per-currency integer net change', () => {
    const model = buildRegisterRowModel(rows, 'year');
    const groups = model.filter((item) => item.kind === 'group');
    expect(groups.length).toBe(2);
    const y2026 = groups[0];
    if (y2026.kind !== 'group') throw new Error('expected group');
    // 10_000 - 2_500 + 5_000 MYR and 100 USD, summed as integers.
    expect([...y2026.group.netChange.entries()]).toEqual([
      ['MYR', 12_500],
      ['USD', 100],
    ]);
    expect(y2026.group.entryCount).toBe(4);
  });

  test('duplicate entry ids count once per group (distinct entries, not rows)', () => {
    const twoRows = makeDatedRows([
      { date: '2026-01-10', amount: 1_000 },
      { date: '2026-01-11', amount: 2_000 },
    ]);
    // Same entry hitting the account twice: two rows, one entry.
    const shared = { ...twoRows[1], entry: twoRows[0].entry };
    const model = buildRegisterRowModel([twoRows[0], shared], 'month');
    const group = model[0];
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.group.entryCount).toBe(1);
  });
});

describe('computeRowModelOffsets + computeGroupedRowWindow', () => {
  const ENTRY_HEIGHT = 20;
  const GROUP_HEIGHT = 28;

  test('offsets are prefix sums over mixed heights', () => {
    const rows = makeDatedRows([
      { date: '2026-01-10', amount: 100 },
      { date: '2026-01-11', amount: 100 },
      { date: '2026-02-01', amount: 100 },
    ]);
    const model = buildRegisterRowModel(rows, 'month');
    const offsets = computeRowModelOffsets(model, ENTRY_HEIGHT, GROUP_HEIGHT);
    // group, entry, entry, group, entry
    expect([...offsets]).toEqual([0, 28, 48, 68, 96, 116]);
  });

  test('binary-search window matches hand-computed ranges over mixed heights', () => {
    // 3 months × 4 entries: each month block is 28 + 80 = 108px tall.
    const rows = makeDatedRows(
      Array.from({ length: 12 }, (_, index) => ({
        date: `2026-0${Math.floor(index / 4) + 1}-1${index % 4}`,
        amount: 100,
      }))
    );
    const model = buildRegisterRowModel(rows, 'month');
    const offsets = computeRowModelOffsets(model, ENTRY_HEIGHT, GROUP_HEIGHT);
    expect(offsets[offsets.length - 1]).toBe(3 * 108);

    // Window [110, 190] with zero overscan: the row containing 110 is month
    // 2's header [108, 136) at index 5; the last overlapping row is the
    // entry spanning [176, 196) at index 8, so the exclusive end is 9.
    expect(
      computeGroupedRowWindow({
        windowSpecs: { top: 110, bottom: 190 },
        bodyTop: 0,
        offsets,
        overscanRows: 0,
      })
    ).toEqual({ start: 5, end: 9 });

    // Same window with overscan expands symmetrically and clamps at 0/n.
    expect(
      computeGroupedRowWindow({
        windowSpecs: { top: 110, bottom: 190 },
        bodyTop: 0,
        offsets,
        overscanRows: 10,
      })
    ).toEqual({ start: 0, end: 15 });

    // Window entirely above the body renders nothing.
    expect(
      computeGroupedRowWindow({
        windowSpecs: { top: 0, bottom: 40 },
        bodyTop: 100,
        offsets,
        overscanRows: 0,
      })
    ).toEqual({ start: 0, end: 0 });
  });
});

// Component-level harness mirroring Register.virtualization.test.ts geometry
// but with groupBy: 'month' — 10 months × 100 compact rows, so the row space
// mixes 28px group headers into 20px entry rows.
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const OVERSCAN_ROWS = 10;
const VIEWPORT_HEIGHT = 400;
const MONTHS = 10;
const ROWS_PER_MONTH = 100;
const GROUP_HEIGHT = LINE_HEIGHT + GROUP_HEADER_EXTRA_HEIGHT;
const MONTH_BLOCK = GROUP_HEIGHT + ROWS_PER_MONTH * LINE_HEIGHT;
const SCROLL_HEIGHT = HEADER_HEIGHT + MONTHS * MONTH_BLOCK;

function makeMonthlyRows(): RegisterRowData[] {
  return makeDatedRows(
    Array.from({ length: MONTHS * ROWS_PER_MONTH }, (_, index) => ({
      date: `2026-${String(Math.floor(index / ROWS_PER_MONTH) + 1).padStart(2, '0')}-15`,
      amount: 1_000,
    }))
  );
}

interface Harness {
  register: Register;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  spacerBefore: HTMLElement;
  spacerAfter: HTMLElement;
  cleanUp(): void;
}

async function createGroupedHarness(): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    groupBy: 'month',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: OVERSCAN_ROWS,
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
  });
  register.render({
    rows: makeMonthlyRows(),
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
    throw new Error('createGroupedHarness: register skeleton missing');
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
    spacerBefore,
    spacerAfter,
    cleanUp() {
      register.cleanUp();
    },
  };
}

function getRenderedEntryIndices(rowsElement: HTMLElement): number[] {
  return Array.from(rowsElement.querySelectorAll('[data-row]')).map((row) =>
    Number(row.getAttribute('data-row-index'))
  );
}

async function scrollTo(harness: Harness, scrollTop: number): Promise<void> {
  harness.scroller.scrollTop = scrollTop;
  dispatchScroll(harness.scroller);
  await wait(0);
}

describe('Register grouped virtualization', () => {
  test('top of scroll: window opens with the first group header at a zero before-spacer', async () => {
    const harness = await createGroupedHarness();
    // Content window [-44, 356]: start clamps to model row 0 (the January
    // header); end = first model row at/past 356 → index 18 (offset 368),
    // plus 10 overscan → 28.
    expect(harness.register.getRenderedRange()).toEqual({ start: 0, end: 28 });
    expect(
      harness.rowsElement.querySelectorAll('[data-group-row]').length
    ).toBe(1);
    const groupRow = harness.rowsElement.querySelector('[data-group-row]');
    expect(groupRow?.getAttribute('data-group-key')).toBe('2026-01');
    expect(groupRow?.querySelector('[data-group-label]')?.textContent).toBe(
      'January 2026'
    );
    expect(groupRow?.querySelector('[data-group-count]')?.textContent).toBe(
      '100 entries'
    );
    const indices = getRenderedEntryIndices(harness.rowsElement);
    expect(indices[0]).toBe(0);
    expect(indices.length).toBe(27);
    expect(harness.spacerBefore.style.height).toBe('0px');
    expect(harness.spacerAfter.style.height).toBe(
      `${MONTHS * MONTH_BLOCK - (GROUP_HEIGHT + 27 * LINE_HEIGHT)}px`
    );
    harness.cleanUp();
  });

  test('window straddling a month boundary renders the interleaved group header', async () => {
    const harness = await createGroupedHarness();
    await scrollTo(harness, 2000);
    // Content window [1956, 2356]. Model row 97 spans [1948, 1968) → raw
    // start 97, minus overscan → 87. February's header is model row 101 at
    // offset 2028; first row at/past 2356 is row 117, plus overscan → 127.
    expect(harness.register.getRenderedRange()).toEqual({
      start: 87,
      end: 127,
    });
    const groupRows = Array.from(
      harness.rowsElement.querySelectorAll('[data-group-row]')
    );
    expect(groupRows.length).toBe(1);
    expect(groupRows[0]?.getAttribute('data-group-key')).toBe('2026-02');
    // Entry indexes stay continuous across the header: 86..99 (January
    // tail) then 100..124 (February head).
    const indices = getRenderedEntryIndices(harness.rowsElement);
    expect(indices[0]).toBe(86);
    expect(indices[indices.length - 1]).toBe(124);
    expect(indices.length).toBe(39);
    // Spacer heights come from the prefix sums, not row multiples.
    expect(harness.spacerBefore.style.height).toBe(
      `${GROUP_HEIGHT + 86 * LINE_HEIGHT}px`
    );
    expect(harness.spacerAfter.style.height).toBe(
      `${MONTHS * MONTH_BLOCK - (2 * GROUP_HEIGHT + 125 * LINE_HEIGHT)}px`
    );
    harness.cleanUp();
  });

  test('bottom of scroll clamps to the last model row with a zero after-spacer', async () => {
    const harness = await createGroupedHarness();
    await scrollTo(harness, SCROLL_HEIGHT - VIEWPORT_HEIGHT);
    const range = harness.register.getRenderedRange();
    expect(range?.end).toBe(MONTHS * (ROWS_PER_MONTH + 1));
    expect(harness.spacerAfter.style.height).toBe('0px');
    const indices = getRenderedEntryIndices(harness.rowsElement);
    expect(indices[indices.length - 1]).toBe(MONTHS * ROWS_PER_MONTH - 1);
    harness.cleanUp();
  });

  test('group net change renders signed integer sums per currency', async () => {
    const harness = await createGroupedHarness();
    const netText = harness.rowsElement
      .querySelector('[data-group-row] [data-group-net]')
      ?.textContent?.trim();
    // 100 rows × 1_000 sen = +1,000.00 MYR, summed in integer minor units.
    expect(netText).toBe('+1,000.00 MYR');
    harness.cleanUp();
  });

  test("groupBy 'none' fast path is unchanged: flat arithmetic windows and no group rows", async () => {
    const container = document.createElement(JOURNALS_TAG_NAME);
    const register = new Register({
      account: 'Assets:Current:Cash-Maybank',
      density: 'compact',
      groupBy: 'none',
      lineHeight: LINE_HEIGHT,
      headerHeight: HEADER_HEIGHT,
      overscanRows: OVERSCAN_ROWS,
      virtualizer: new Virtualizer({
        overscrollSize: 0,
        intersectionObserverMargin: 0,
      }),
    });
    register.render({
      rows: makeMonthlyRows(),
      container,
      parentNode: document.body,
    });
    const shadowRoot = container.shadowRoot;
    const scroller = shadowRoot?.querySelector('[data-scroller]');
    if (scroller instanceof HTMLElement) {
      stubScrollerGeometry(scroller, {
        height: VIEWPORT_HEIGHT,
        scrollHeight: HEADER_HEIGHT + MONTHS * ROWS_PER_MONTH * LINE_HEIGHT,
      });
    }
    await wait(0);
    // Same numbers as Register.virtualization.test.ts's top-of-scroll case:
    // pure row arithmetic, no offsets involved.
    expect(register.getRenderedRange()).toEqual({ start: 0, end: 28 });
    expect(shadowRoot?.querySelectorAll('[data-group-row]').length).toBe(0);
    const before = shadowRoot?.querySelector(
      '[data-register-spacer="before"]'
    ) as HTMLElement;
    expect(before.style.height).toBe('0px');
    register.cleanUp();
  });
});
