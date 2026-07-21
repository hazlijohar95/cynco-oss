import { describe, expect, test } from 'bun:test';

import { EntryStore } from '../src/EntryStore';
import type { LedgerEntry, Posting } from '../src/types';

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
    ['Assets:Cash', 10_000],
    ['Equity:Opening-Balances', -10_000],
  ]),
  makeEntry('e2', '2025-01-15', [
    ['Assets:Cash', -3_000],
    ['Expenses:Rent', 3_000],
  ]),
  makeEntry('e3', '2025-01-15', [
    ['Assets:Cash', 500, 'USD'],
    ['Income:Export', -500, 'USD'],
  ]),
  makeEntry('e4', '2025-02-10', [
    ['Assets:Cash', -2_000],
    ['Assets:Bank:Maybank', 2_000],
  ]),
  makeEntry('e5', '2025-03-01', [
    ['Assets:Cash', 4_000],
    ['Income:Sales', -4_000],
  ]),
];

describe('EntryStore.getBalancesAsOf', () => {
  const store = new EntryStore(ENTRIES);

  test('balance as of a date includes that whole day', () => {
    expect(store.getBalancesAsOf('Assets:Cash', '2025-01-15')).toEqual(
      new Map([
        ['MYR', 7_000],
        ['USD', 500],
      ])
    );
  });

  test('balance between posting dates carries forward', () => {
    expect(store.getBalancesAsOf('Assets:Cash', '2025-02-28').get('MYR')).toBe(
      5_000
    );
  });

  test('dates before the first posting yield an empty map', () => {
    expect(store.getBalancesAsOf('Assets:Cash', '2024-12-31').size).toBe(0);
  });

  test('dates after the last posting yield the closing balance', () => {
    expect(store.getBalancesAsOf('Assets:Cash', '2099-12-31').get('MYR')).toBe(
      9_000
    );
  });

  test('includeDescendants rolls child accounts into the balance', () => {
    expect(
      store.getBalancesAsOf('Assets', '2025-02-10', {
        includeDescendants: true,
      })
    ).toEqual(
      new Map([
        ['MYR', 7_000],
        ['USD', 500],
      ])
    );
    // Own postings only: the Assets group itself has none.
    expect(store.getBalancesAsOf('Assets', '2025-02-10').size).toBe(0);
  });

  test('currencies netting to zero are omitted (absence means zero)', () => {
    const wash = new EntryStore([
      makeEntry('w1', '2025-01-01', [
        ['Assets:Cash', 100],
        ['Income:Sales', -100],
      ]),
      makeEntry('w2', '2025-01-02', [
        ['Assets:Cash', -100],
        ['Expenses:Fees', 100],
      ]),
    ]);
    expect(wash.getBalancesAsOf('Assets:Cash', '2025-01-02').size).toBe(0);
  });

  test('invalid account paths yield an empty map', () => {
    expect(store.getBalancesAsOf('Assets::Cash', '2025-01-15').size).toBe(0);
    expect(store.getBalancesAsOf('', '2025-01-15').size).toBe(0);
  });

  test('balances stay consistent across mutations', () => {
    const mutable = new EntryStore(ENTRIES);
    expect(
      mutable.getBalancesAsOf('Assets:Cash', '2025-03-01').get('MYR')
    ).toBe(9_000);
    mutable.addEntries([
      makeEntry('e6', '2025-02-20', [
        ['Assets:Cash', 1_000],
        ['Income:Sales', -1_000],
      ]),
    ]);
    expect(
      mutable.getBalancesAsOf('Assets:Cash', '2025-03-01').get('MYR')
    ).toBe(10_000);
    expect(
      mutable.getBalancesAsOf('Assets:Cash', '2025-02-19').get('MYR')
    ).toBe(5_000);
  });
});

describe('EntryStore.getBalanceChanges', () => {
  const store = new EntryStore(ENTRIES);

  test('sums postings inside the inclusive date range', () => {
    // January activity on Assets:Cash: +10000 - 3000, plus USD +500.
    expect(
      store.getBalanceChanges('Assets:Cash', '2025-01-01', '2025-01-31')
    ).toEqual(
      new Map([
        ['MYR', 7_000],
        ['USD', 500],
      ])
    );
  });

  test('both range endpoints are inclusive', () => {
    expect(
      store.getBalanceChanges('Assets:Cash', '2025-01-15', '2025-01-15')
    ).toEqual(
      new Map([
        ['MYR', -3_000],
        ['USD', 500],
      ])
    );
  });

  test('a period is the difference of its as-of balances', () => {
    const change = store
      .getBalanceChanges('Assets:Cash', '2025-02-01', '2025-03-31')
      .get('MYR');
    const opening = store
      .getBalancesAsOf('Assets:Cash', '2025-01-31')
      .get('MYR');
    const closing = store
      .getBalancesAsOf('Assets:Cash', '2025-03-31')
      .get('MYR');
    expect(change).toBe(closing! - opening!);
  });

  test('income period activity works rolled up (the P&L query)', () => {
    expect(
      store.getBalanceChanges('Income', '2025-01-01', '2025-12-31', {
        includeDescendants: true,
      })
    ).toEqual(
      new Map([
        ['MYR', -4_000],
        ['USD', -500],
      ])
    );
  });

  test('ranges with no postings yield an empty map', () => {
    expect(
      store.getBalanceChanges('Assets:Cash', '2025-02-11', '2025-02-28').size
    ).toBe(0);
  });

  test('inverted ranges yield an empty map', () => {
    expect(
      store.getBalanceChanges('Assets:Cash', '2025-03-01', '2025-01-01').size
    ).toBe(0);
  });

  test('invalid account paths yield an empty map', () => {
    expect(
      store.getBalanceChanges(':bad', '2025-01-01', '2025-12-31').size
    ).toBe(0);
  });
});
