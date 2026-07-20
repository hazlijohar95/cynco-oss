import { describe, expect, test } from 'bun:test';

import {
  addMinorUnits,
  assertSafeMinorUnits,
  isEntryBalanced,
  isMinorUnitsOverflow,
  sumPostingsByCurrency,
  sumPostingsByCurrencyChecked,
} from '../src/money';
import type { LedgerEntry, Posting } from '../src/types';

function makeEntry(postings: Posting[]): LedgerEntry {
  return {
    id: 'e1',
    date: '2025-01-01',
    flag: 'cleared',
    payee: null,
    narration: '',
    tags: [],
    links: [],
    postings,
  };
}

describe('isEntryBalanced', () => {
  test('balanced two-leg entry', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash', amount: 150, currency: 'MYR' },
          { account: 'Income:Sales', amount: -150, currency: 'MYR' },
        ])
      )
    ).toBe(true);
  });

  test('unbalanced entry', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash', amount: 150, currency: 'MYR' },
          { account: 'Income:Sales', amount: -149, currency: 'MYR' },
        ])
      )
    ).toBe(false);
  });

  test('multi-currency entry balances per currency independently', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash-Wise', amount: 5000, currency: 'USD' },
          { account: 'Income:Export', amount: -5000, currency: 'USD' },
          { account: 'Expenses:Bank', amount: 300, currency: 'MYR' },
          { account: 'Assets:Cash', amount: -300, currency: 'MYR' },
        ])
      )
    ).toBe(true);
  });

  test('multi-currency entry unbalanced in one currency is unbalanced', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash-Wise', amount: 5000, currency: 'USD' },
          { account: 'Income:Export', amount: -5000, currency: 'USD' },
          { account: 'Expenses:Bank', amount: 300, currency: 'MYR' },
        ])
      )
    ).toBe(false);
  });

  test('zero-amount postings and empty entries are balanced', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash', amount: 0, currency: 'MYR' },
          { account: 'Equity:Opening', amount: 0, currency: 'MYR' },
        ])
      )
    ).toBe(true);
    expect(isEntryBalanced(makeEntry([]))).toBe(true);
  });

  test('float amounts are reported unbalanced, never repaired', () => {
    expect(
      isEntryBalanced(
        makeEntry([
          { account: 'Assets:Cash', amount: 1.5, currency: 'MYR' },
          { account: 'Income:Sales', amount: -1.5, currency: 'MYR' },
        ])
      )
    ).toBe(false);
  });
});

describe('sumPostingsByCurrency', () => {
  test('groups totals per currency and skips unsafe amounts', () => {
    const totals = sumPostingsByCurrency([
      { account: 'a', amount: 100, currency: 'MYR' },
      { account: 'b', amount: 250, currency: 'MYR' },
      { account: 'c', amount: -50, currency: 'USD' },
      { account: 'd', amount: 0.5, currency: 'MYR' },
    ]);
    expect(totals.get('MYR')).toBe(350);
    expect(totals.get('USD')).toBe(-50);
    expect(totals.size).toBe(2);
  });

  test('empty postings yield an empty map', () => {
    expect(sumPostingsByCurrency([]).size).toBe(0);
  });
});

describe('sumPostingsByCurrencyChecked / aggregate overflow', () => {
  test('flags a currency whose aggregate crosses 2^53', () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    // Two individually-safe postings whose sum leaves the safe range.
    const { totals, overflowCurrencies } = sumPostingsByCurrencyChecked([
      { account: 'a', amount: half, currency: 'MYR' },
      { account: 'b', amount: half, currency: 'MYR' },
      { account: 'c', amount: 100, currency: 'USD' },
    ]);
    expect(overflowCurrencies.has('MYR')).toBe(true);
    expect(overflowCurrencies.has('USD')).toBe(false);
    // The overflowed total is no longer trustworthy, but USD stays exact.
    expect(totals.get('USD')).toBe(100);
  });

  test('exact aggregates report no overflow', () => {
    const { overflowCurrencies } = sumPostingsByCurrencyChecked([
      { account: 'a', amount: 1_000_000, currency: 'MYR' },
      { account: 'b', amount: -400_000, currency: 'MYR' },
    ]);
    expect(overflowCurrencies.size).toBe(0);
  });

  test('isMinorUnitsOverflow detects values past the safe range', () => {
    expect(isMinorUnitsOverflow(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(isMinorUnitsOverflow(Number.MAX_SAFE_INTEGER + 1)).toBe(true);
    expect(isMinorUnitsOverflow(-(Number.MAX_SAFE_INTEGER + 1))).toBe(true);
  });
});

describe('addMinorUnits / assertSafeMinorUnits', () => {
  test('adds exact integers', () => {
    expect(addMinorUnits(150, -50)).toBe(100);
  });

  test('throws on floats — programmer error, not user data', () => {
    expect(() => assertSafeMinorUnits(1.5)).toThrow(TypeError);
    expect(() => addMinorUnits(1.5, 1)).toThrow(TypeError);
  });

  test('throws when the sum leaves the safe-integer range', () => {
    expect(() => addMinorUnits(Number.MAX_SAFE_INTEGER, 1)).toThrow(TypeError);
  });
});
