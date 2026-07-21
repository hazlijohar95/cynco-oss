import { describe, expect, test } from 'bun:test';

import { deriveIncomeStatement } from '../src/incomeStatement';
import { createAccountTaxonomy } from '../src/taxonomy';
import type { EntryFlag, LedgerEntry, Posting } from '../src/types';

function makeEntry(
  id: string,
  date: string,
  postings: Array<[account: string, amount: number, currency?: string]>,
  flag: EntryFlag = 'cleared'
): LedgerEntry {
  return {
    id,
    date,
    flag,
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

const taxonomy = createAccountTaxonomy({
  overrides: { 'Income:Sales-Returns': { contra: true } },
});

const ENTRIES: LedgerEntry[] = [
  // January: 40k sales, 12k rent.
  makeEntry('e1', '2025-01-10', [
    ['Assets:Cash', 40_000],
    ['Income:Sales', -40_000],
  ]),
  makeEntry('e2', '2025-01-31', [
    ['Expenses:Rent', 12_000],
    ['Assets:Cash', -12_000],
  ]),
  // February: 25k sales, 3k returns, 12k rent.
  makeEntry('e3', '2025-02-05', [
    ['Assets:Cash', 25_000],
    ['Income:Sales', -25_000],
  ]),
  makeEntry('e4', '2025-02-12', [
    ['Income:Sales-Returns', 3_000],
    ['Assets:Cash', -3_000],
  ]),
  makeEntry('e5', '2025-02-28', [
    ['Expenses:Rent', 12_000],
    ['Assets:Cash', -12_000],
  ]),
];

const JAN = { label: 'Jan', dateFrom: '2025-01-01', dateTo: '2025-01-31' };
const FEB = { label: 'Feb', dateFrom: '2025-02-01', dateTo: '2025-02-28' };

describe('deriveIncomeStatement', () => {
  test('revenue reads positive and contra income negative (section flip)', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [FEB],
      taxonomy,
    }).sections;
    const sales = section.income.find(
      (line) => line.account === 'Income:Sales'
    );
    const returns = section.income.find(
      (line) => line.account === 'Income:Sales-Returns'
    );
    expect(sales?.amounts).toEqual([25_000]);
    expect(returns?.amounts).toEqual([-3_000]);
  });

  test('totals and net income per period', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [JAN, FEB],
      taxonomy,
    }).sections;
    expect(section.totalIncome).toEqual([40_000, 22_000]);
    expect(section.totalExpenses).toEqual([12_000, 12_000]);
    expect(section.netIncome).toEqual([28_000, 10_000]);
  });

  test('comparative periods align amounts to column order', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [FEB, JAN],
      taxonomy,
    }).sections;
    const sales = section.income.find(
      (line) => line.account === 'Income:Sales'
    );
    expect(sales?.amounts).toEqual([25_000, 40_000]);
  });

  test('balance sheet accounts never appear on the P&L', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [JAN],
      taxonomy,
    }).sections;
    const accounts = [
      ...section.income.map((line) => line.account),
      ...section.expenses.map((line) => line.account),
    ];
    expect(accounts.some((account) => account.startsWith('Assets'))).toBe(
      false
    );
  });

  test('void entries are excluded from meaning', () => {
    const withVoid = [
      ...ENTRIES,
      makeEntry(
        'v1',
        '2025-01-15',
        [
          ['Assets:Cash', 9_000],
          ['Income:Sales', -9_000],
        ],
        'void'
      ),
    ];
    const [section] = deriveIncomeStatement(withVoid, {
      periods: [JAN],
      taxonomy,
    }).sections;
    expect(section.totalIncome).toEqual([40_000]);
  });

  test('activity outside every period contributes nothing', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [JAN],
      taxonomy,
    }).sections;
    const returns = section.income.find(
      (line) => line.account === 'Income:Sales-Returns'
    );
    expect(returns).toBeUndefined();
  });

  test('unclassified activity is surfaced, never guessed into a section', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-01-20', [
        ['Suspense:Unknown', -700],
        ['Assets:Cash', 700],
      ]),
    ];
    const [section] = deriveIncomeStatement(withSuspense, {
      periods: [JAN],
      taxonomy,
    }).sections;
    expect(section.unclassified).toEqual([
      { account: 'Suspense:Unknown', amounts: [-700] },
    ]);
    // Unclassified amounts stay ledger-signed and out of the totals.
    expect(section.totalIncome).toEqual([40_000]);
  });

  test('multi-currency activity yields one section per currency', () => {
    const multi = [
      ...ENTRIES,
      makeEntry('u1', '2025-01-15', [
        ['Assets:Bank:Wise', 900, 'USD'],
        ['Income:Export', -900, 'USD'],
      ]),
    ];
    const data = deriveIncomeStatement(multi, { periods: [JAN], taxonomy });
    expect(data.sections.map((section) => section.currency)).toEqual([
      'MYR',
      'USD',
    ]);
    expect(data.sections[1].totalIncome).toEqual([900]);
  });

  test('without a taxonomy everything is unclassified — the statement never guesses', () => {
    const [section] = deriveIncomeStatement(ENTRIES, {
      periods: [JAN],
    }).sections;
    expect(section.income).toEqual([]);
    expect(section.expenses).toEqual([]);
    expect(section.unclassified.length).toBeGreaterThan(0);
  });
});
