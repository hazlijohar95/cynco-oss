import { describe, expect, test } from 'bun:test';

import { AccountStore } from '../src/AccountStore';
import type { AccountRow, LedgerEntry, Posting } from '../src/types';

// Small handcrafted ledger: enough shape to exercise nesting, sibling
// sorting, balances, and zero-activity accounts declared via accountPaths.
function makeEntry(
  id: string,
  date: string,
  postings: Array<[account: string, amount: number, currency?: string]>
): LedgerEntry {
  return {
    id,
    date,
    flag: 'cleared',
    payee: null,
    narration: '',
    tags: [],
    links: [],
    postings: postings.map(
      ([account, amount, currency]): Posting => ({
        account,
        amount,
        currency: currency ?? 'MYR',
      })
    ),
  };
}

const ENTRIES: LedgerEntry[] = [
  makeEntry('e1', '2025-01-01', [
    ['Assets:Cash', 150],
    ['Income:Sales', -150],
  ]),
  makeEntry('e2', '2025-01-02', [
    ['Assets:Bank:Maybank', 100_000],
    ['Liabilities:Loan', -100_000],
  ]),
  makeEntry('e3', '2025-01-03', [
    ['Expenses:Food:Groceries', 500],
    ['Assets:Cash', -500],
  ]),
  makeEntry('e4', '2025-01-04', [
    ['Assets:Bank:CIMB', 2_000, 'USD'],
    ['Income:Sales', -2_000, 'USD'],
  ]),
];

function buildStore(): AccountStore {
  return new AccountStore({
    entries: ENTRIES,
    accountPaths: ['Equity:Opening'],
  });
}

// Compact behavioral projection: one string per visible row, encoding the
// facts each test cares about, instead of a big object snapshot.
function projectRows(rows: readonly AccountRow[]): string[] {
  return rows.map((row) => {
    const balances = [...row.rolledBalances.entries()]
      .map(([currency, amount]) => `${currency}=${amount}`)
      .join(',');
    return `${row.path} d${row.depth} ${row.kind} ${row.posInSet}/${row.setSize}${
      balances === '' ? '' : ` ${balances}`
    }`;
  });
}

describe('AccountStore projection', () => {
  test('builds the implied tree, fully expanded, siblings sorted by name', () => {
    const store = buildStore();
    expect(store.getAccountCount()).toBe(14);
    expect(store.getVisibleCount()).toBe(14);
    expect(projectRows(store.getVisibleSlice(0, 14))).toEqual([
      'Assets d0 group 1/5 MYR=99650,USD=2000',
      'Assets:Bank d1 group 1/2 MYR=100000,USD=2000',
      'Assets:Bank:CIMB d2 leaf 1/2 USD=2000',
      'Assets:Bank:Maybank d2 leaf 2/2 MYR=100000',
      'Assets:Cash d1 leaf 2/2 MYR=-350',
      'Equity d0 group 2/5',
      'Equity:Opening d1 leaf 1/1',
      'Expenses d0 group 3/5 MYR=500',
      'Expenses:Food d1 group 1/1 MYR=500',
      'Expenses:Food:Groceries d2 leaf 1/1 MYR=500',
      'Income d0 group 4/5 MYR=-150,USD=-2000',
      'Income:Sales d1 leaf 1/1 MYR=-150,USD=-2000',
      'Liabilities d0 group 5/5 MYR=-100000',
      'Liabilities:Loan d1 leaf 1/1 MYR=-100000',
    ]);
  });

  test('collapsing a group hides its subtree from the projection', () => {
    const store = buildStore();
    store.setExpanded('Assets', false);
    expect(store.getVisibleCount()).toBe(10);
    const paths = store.getVisibleSlice(0, 10).map((row) => row.path);
    expect(paths[0]).toBe('Assets');
    expect(paths).not.toContain('Assets:Cash');
    expect(paths).not.toContain('Assets:Bank:Maybank');
    // Re-expanding restores exactly the previous projection.
    store.setExpanded('Assets', true);
    expect(store.getVisibleCount()).toBe(14);
  });

  test('collapsing a nested group keeps its own row visible', () => {
    const store = buildStore();
    store.setExpanded('Assets:Bank', false);
    const paths = store.getVisibleSlice(0, 20).map((row) => row.path);
    expect(paths).toContain('Assets:Bank');
    expect(paths).not.toContain('Assets:Bank:CIMB');
    const bankRow = store.getVisibleSlice(1, 2)[0];
    expect(bankRow.path).toBe('Assets:Bank');
    expect(bankRow.expanded).toBe(false);
  });

  test('collapseAll leaves only top-level rows; expandAll restores everything', () => {
    const store = buildStore();
    store.collapseAll();
    expect(
      projectRows(store.getVisibleSlice(0, 99)).map((s) => s.split(' ')[0])
    ).toEqual(['Assets', 'Equity', 'Expenses', 'Income', 'Liabilities']);
    store.expandAll();
    expect(store.getVisibleCount()).toBe(14);
  });

  test('slices clamp to the valid range', () => {
    const store = buildStore();
    expect(store.getVisibleSlice(-3, 2)).toHaveLength(2);
    expect(store.getVisibleSlice(12, 99)).toHaveLength(2);
    expect(store.getVisibleSlice(5, 5)).toHaveLength(0);
    expect(store.getVisibleSlice(20, 30)).toHaveLength(0);
  });

  test('setExpanded degrades gracefully on leaves and unknown paths', () => {
    const store = buildStore();
    store.setExpanded('Assets:Cash', true); // leaf: no-op
    store.setExpanded('Does:Not:Exist', false); // unknown: no-op
    expect(store.getVisibleCount()).toBe(14);
    expect(store.isExpanded('Assets:Cash')).toBe(false);
  });

  test('own vs rolled balances distinguish direct postings from subtree sums', () => {
    const store = buildStore();
    // 'Assets' has no direct postings — own is empty, rolled sums children.
    expect(store.getOwnBalances('Assets')?.size).toBe(0);
    expect(store.getRolledBalances('Assets')?.get('MYR')).toBe(99_650);
    // Leaf accounts have identical own and rolled balances.
    expect(store.getOwnBalances('Assets:Cash')?.get('MYR')).toBe(-350);
    expect(store.getRolledBalances('Assets:Cash')?.get('MYR')).toBe(-350);
    expect(store.getPostingCount('Assets:Cash')).toBe(2);
    expect(store.getOwnBalances('Nope')).toBeNull();
  });

  test('rolled balances match a brute-force recomputation for every account', () => {
    const store = buildStore();
    const rows = store.getVisibleSlice(0, store.getVisibleCount());
    for (const row of rows) {
      const bruteForce = new Map<string, number>();
      for (const entry of ENTRIES) {
        for (const posting of entry.postings) {
          if (
            posting.account === row.path ||
            posting.account.startsWith(`${row.path}:`)
          ) {
            bruteForce.set(
              posting.currency,
              (bruteForce.get(posting.currency) ?? 0) + posting.amount
            );
          }
        }
      }
      for (const [currency, amount] of bruteForce) {
        if (amount !== 0) {
          expect(row.rolledBalances.get(currency)).toBe(amount);
        }
      }
      expect(row.rolledBalances.size).toBe(
        [...bruteForce.values()].filter((amount) => amount !== 0).length
      );
    }
  });

  test('invalid posting accounts and paths are skipped, not thrown', () => {
    const store = new AccountStore({
      entries: [
        makeEntry('bad', '2025-01-01', [
          ['Assets::Broken', 100],
          ['Assets:Cash', -100],
        ]),
      ],
      accountPaths: ['', ':Nope:'],
    });
    expect(store.hasAccount('Assets:Cash')).toBe(true);
    expect(store.hasAccount('Assets::Broken')).toBe(false);
    expect(store.getAccountCount()).toBe(2);
  });

  test('normal ledgers report no balance overflow', () => {
    const store = buildStore();
    expect(store.hasBalanceOverflow()).toBe(false);
    expect(store.hasBalanceOverflow('MYR')).toBe(false);
    expect(store.hasBalanceOverflow('USD')).toBe(false);
  });

  test('own-balance aggregate past 2^53 is flagged, not silently poisoned', () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const store = new AccountStore({
      entries: [
        // Two safe-integer postings to the same account whose sum overflows.
        makeEntry('big1', '2025-01-01', [
          ['Assets:Cash', half],
          ['Equity:Opening', -half],
        ]),
        makeEntry('big2', '2025-01-02', [
          ['Assets:Cash', half],
          ['Equity:Opening', -half],
        ]),
      ],
    });
    expect(store.hasBalanceOverflow('MYR')).toBe(true);
    expect(store.hasBalanceOverflow()).toBe(true);
    expect(store.hasBalanceOverflow('USD')).toBe(false);
  });

  test('roll-up across siblings past 2^53 is flagged even when each own balance is safe', () => {
    const near = Number.MAX_SAFE_INTEGER - 10;
    const store = new AccountStore({
      entries: [
        // Two sibling leaf accounts, each individually safe, that overflow
        // only when rolled into their shared parent.
        makeEntry('s1', '2025-01-01', [
          ['Assets:A', near],
          ['Equity:Opening', -near],
        ]),
        makeEntry('s2', '2025-01-02', [
          ['Assets:B', near],
          ['Equity:Opening', -near],
        ]),
      ],
    });
    // Each leaf own-balance is safe...
    expect(
      Number.isSafeInteger(store.getOwnBalances('Assets:A')?.get('MYR') ?? 0)
    ).toBe(true);
    expect(
      Number.isSafeInteger(store.getOwnBalances('Assets:B')?.get('MYR') ?? 0)
    ).toBe(true);
    // ...but the Assets roll-up crosses 2^53 and must be flagged.
    expect(store.hasBalanceOverflow('MYR')).toBe(true);
  });
});
