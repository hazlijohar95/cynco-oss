import { describe, expect, test } from 'bun:test';

import { checkBalanceAssertions } from '../src/assertions';
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

const store = new EntryStore([
  makeEntry('e1', '2025-01-01', [
    ['Assets:Cash', 10_000],
    ['Equity:Opening-Balances', -10_000],
  ]),
  makeEntry('e2', '2025-01-20', [
    ['Assets:Cash', -2_500],
    ['Expenses:Rent', 2_500],
  ]),
  makeEntry('e3', '2025-02-01', [
    ['Assets:Bank:Maybank', 4_000],
    ['Assets:Cash', -4_000],
  ]),
]);

describe('checkBalanceAssertions', () => {
  test('passing assertion reports ok with zero difference', () => {
    const [result] = checkBalanceAssertions(store, [
      {
        account: 'Assets:Cash',
        date: '2025-01-31',
        amount: 7_500,
        currency: 'MYR',
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(7_500);
    expect(result.difference).toBe(0);
  });

  test('failing assertion reports the signed discrepancy and repairs nothing', () => {
    const [result] = checkBalanceAssertions(store, [
      {
        account: 'Assets:Cash',
        date: '2025-01-31',
        amount: 7_000,
        currency: 'MYR',
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe(7_500);
    expect(result.difference).toBe(500);
    // Surfacing only: the store itself is untouched.
    expect(store.getEntryCount()).toBe(3);
  });

  test('assertions are date-scoped', () => {
    const results = checkBalanceAssertions(store, [
      {
        account: 'Assets:Cash',
        date: '2025-01-19',
        amount: 10_000,
        currency: 'MYR',
      },
      {
        account: 'Assets:Cash',
        date: '2025-02-01',
        amount: 3_500,
        currency: 'MYR',
      },
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
  });

  test('includeDescendants asserts the rolled-up balance', () => {
    const [own, rolled] = checkBalanceAssertions(store, [
      { account: 'Assets', date: '2025-02-01', amount: 7_500, currency: 'MYR' },
      {
        account: 'Assets',
        date: '2025-02-01',
        amount: 7_500,
        currency: 'MYR',
        includeDescendants: true,
      },
    ]);
    expect(own.ok).toBe(false);
    expect(own.actual).toBe(0);
    expect(rolled.ok).toBe(true);
  });

  test('asserting zero on an account with no postings passes (absence means zero)', () => {
    const [result] = checkBalanceAssertions(store, [
      {
        account: 'Assets:Vault',
        date: '2025-12-31',
        amount: 0,
        currency: 'MYR',
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(0);
  });

  test('currency scoping checks only the asserted currency', () => {
    const multi = new EntryStore([
      makeEntry('m1', '2025-01-01', [
        ['Assets:Cash', 100, 'USD'],
        ['Income:Export', -100, 'USD'],
      ]),
    ]);
    const [result] = checkBalanceAssertions(multi, [
      {
        account: 'Assets:Cash',
        date: '2025-01-01',
        amount: 0,
        currency: 'MYR',
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test('invalid paths degrade to a zero actual balance', () => {
    const [result] = checkBalanceAssertions(store, [
      { account: ':bad', date: '2025-01-31', amount: 100, currency: 'MYR' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe(0);
    expect(result.difference).toBe(-100);
  });

  test('non-integer expected amounts always fail, never repaired', () => {
    const [result] = checkBalanceAssertions(store, [
      {
        account: 'Assets:Cash',
        date: '2025-01-31',
        amount: 7_500.5,
        currency: 'MYR',
      },
    ]);
    expect(result.ok).toBe(false);
  });

  test('results preserve input order and assertion references', () => {
    const assertions = [
      {
        account: 'Assets:Cash',
        date: '2025-01-31',
        amount: 7_500,
        currency: 'MYR',
      },
      {
        account: 'Expenses:Rent',
        date: '2025-01-31',
        amount: 2_500,
        currency: 'MYR',
      },
    ];
    const results = checkBalanceAssertions(store, assertions);
    expect(results[0].assertion).toBe(assertions[0]);
    expect(results[1].assertion).toBe(assertions[1]);
  });
});
