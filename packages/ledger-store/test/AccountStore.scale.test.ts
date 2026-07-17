import { describe, expect, test } from 'bun:test';

import { AccountStore } from '../src/AccountStore';

// 10 top-level groups x 10 mid groups x 100 leaves = 10,000 leaf accounts
// plus 110 implied groups. Zero-padded names make code-point sibling order
// equal numeric order, so positional expectations stay readable.
const TOP_COUNT = 10;
const MID_COUNT = 10;
const LEAF_COUNT = 100;
const GROUP_COUNT = TOP_COUNT + TOP_COUNT * MID_COUNT;
const TOTAL_ACCOUNTS = GROUP_COUNT + TOP_COUNT * MID_COUNT * LEAF_COUNT;

function generatePaths(): string[] {
  const paths: string[] = [];
  for (let top = 0; top < TOP_COUNT; top += 1) {
    for (let mid = 0; mid < MID_COUNT; mid += 1) {
      for (let leaf = 0; leaf < LEAF_COUNT; leaf += 1) {
        paths.push(
          `Top${String(top).padStart(2, '0')}:Mid${String(mid).padStart(2, '0')}:Leaf${String(leaf).padStart(3, '0')}`
        );
      }
    }
  }
  return paths;
}

describe('AccountStore at scale (10k accounts)', () => {
  const store = new AccountStore({ accountPaths: generatePaths() });

  test('builds all accounts including implied groups', () => {
    expect(store.getAccountCount()).toBe(TOTAL_ACCOUNTS);
  });

  test('expandAll shows every account; collapseAll shows only top level', () => {
    store.expandAll();
    expect(store.getVisibleCount()).toBe(TOTAL_ACCOUNTS);
    store.collapseAll();
    expect(store.getVisibleCount()).toBe(TOP_COUNT);
    store.expandAll();
    expect(store.getVisibleCount()).toBe(TOTAL_ACCOUNTS);
  });

  test('slice reads are correct at the projection boundaries', () => {
    store.expandAll();
    const first = store.getVisibleSlice(0, 3).map((row) => row.path);
    expect(first).toEqual(['Top00', 'Top00:Mid00', 'Top00:Mid00:Leaf000']);

    const last = store
      .getVisibleSlice(TOTAL_ACCOUNTS - 2, TOTAL_ACCOUNTS + 50)
      .map((row) => row.path);
    expect(last).toEqual(['Top09:Mid09:Leaf098', 'Top09:Mid09:Leaf099']);

    expect(store.getVisibleSlice(-10, 1)).toHaveLength(1);
    expect(
      store.getVisibleSlice(TOTAL_ACCOUNTS, TOTAL_ACCOUNTS + 5)
    ).toHaveLength(0);
  });

  test('a middle slice matches the same window of the full projection', () => {
    store.expandAll();
    const full = store.getVisibleSlice(0, TOTAL_ACCOUNTS);
    const windowStart = Math.floor(TOTAL_ACCOUNTS / 2);
    const windowRows = store.getVisibleSlice(windowStart, windowStart + 25);
    expect(windowRows.map((row) => row.path)).toEqual(
      full.slice(windowStart, windowStart + 25).map((row) => row.path)
    );
  });

  test('posInSet/setSize are consistent across a wide sibling group', () => {
    store.expandAll();
    const full = store.getVisibleSlice(0, TOTAL_ACCOUNTS);
    // First leaf group: rows 2..101 are Leaf000..Leaf099 under Top00:Mid00.
    const leafRows = full.slice(2, 2 + LEAF_COUNT);
    for (let index = 0; index < leafRows.length; index += 1) {
      expect(leafRows[index].setSize).toBe(LEAF_COUNT);
      expect(leafRows[index].posInSet).toBe(index + 1);
      expect(leafRows[index].kind).toBe('leaf');
      expect(leafRows[index].depth).toBe(2);
    }
  });

  test('collapsing one mid group removes exactly its leaves', () => {
    store.expandAll();
    store.setExpanded('Top05:Mid05', false);
    expect(store.getVisibleCount()).toBe(TOTAL_ACCOUNTS - LEAF_COUNT);
    store.setExpanded('Top05:Mid05', true);
    expect(store.getVisibleCount()).toBe(TOTAL_ACCOUNTS);
  });
});
