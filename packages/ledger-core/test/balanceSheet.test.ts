import { describe, expect, test } from 'bun:test';

import { deriveBalanceSheet } from '../src/balanceSheet';
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

const taxonomy = createAccountTaxonomy();

const ENTRIES: LedgerEntry[] = [
  // FY2024: opening capital and 8k profit.
  makeEntry('e1', '2024-01-01', [
    ['Assets:Cash', 100_000],
    ['Equity:Capital', -100_000],
  ]),
  makeEntry('e2', '2024-06-01', [
    ['Assets:Cash', 8_000],
    ['Income:Sales', -8_000],
  ]),
  // FY2025: 30k sales, 10k rent, a loan.
  makeEntry('e3', '2025-02-01', [
    ['Assets:Cash', 30_000],
    ['Income:Sales', -30_000],
  ]),
  makeEntry('e4', '2025-03-01', [
    ['Expenses:Rent', 10_000],
    ['Assets:Cash', -10_000],
  ]),
  makeEntry('e5', '2025-04-01', [
    ['Assets:Cash', 50_000],
    ['Liabilities:Loan', -50_000],
  ]),
];

describe('deriveBalanceSheet', () => {
  test('the accounting equation holds via virtual retained earnings', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    expect(section.totalAssets).toEqual([178_000]);
    expect(section.totalLiabilities).toEqual([50_000]);
    // Booked capital 100k + all-time earnings 28k.
    expect(section.totalEquity).toEqual([128_000]);
    expect(section.retainedEarnings).toEqual([28_000]);
    expect(section.currentEarnings).toEqual([0]);
    expect(section.balancedByDate).toEqual([true]);
  });

  test('fiscal-year start splits retained from current-year earnings', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [
        {
          label: 'FY2025',
          asOf: '2025-12-31',
          fiscalYearStart: '2025-01-01',
        },
      ],
      taxonomy,
    }).sections;
    expect(section.retainedEarnings).toEqual([8_000]);
    expect(section.currentEarnings).toEqual([20_000]);
    expect(section.totalEquity).toEqual([128_000]);
    expect(section.balancedByDate).toEqual([true]);
  });

  test('comparative dates report cumulative positions per column', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [
        { label: 'FY2024', asOf: '2024-12-31' },
        { label: 'FY2025', asOf: '2025-12-31' },
      ],
      taxonomy,
    }).sections;
    const cash = section.assets.find((line) => line.account === 'Assets:Cash');
    expect(cash?.amounts).toEqual([108_000, 178_000]);
    const loan = section.liabilities.find(
      (line) => line.account === 'Liabilities:Loan'
    );
    // Liabilities flip to positive presentation; absent in FY2024.
    expect(loan?.amounts).toEqual([0, 50_000]);
    expect(section.balancedByDate).toEqual([true, true]);
  });

  test('liabilities and equity are presentation-flipped to positive', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    const capital = section.equity.find(
      (line) => line.account === 'Equity:Capital'
    );
    expect(capital?.amounts).toEqual([100_000]);
  });

  test('income and expense accounts never appear as balance sheet lines', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    const accounts = [
      ...section.assets,
      ...section.liabilities,
      ...section.equity,
    ].map((line) => line.account);
    expect(
      accounts.some(
        (account) =>
          account.startsWith('Income') || account.startsWith('Expenses')
      )
    ).toBe(false);
  });

  test('a cumulative loss reports as negative retained earnings', () => {
    const losing = [
      makeEntry('l1', '2025-01-01', [
        ['Expenses:Rent', 5_000],
        ['Assets:Cash', -5_000],
      ]),
    ];
    const [section] = deriveBalanceSheet(losing, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    expect(section.retainedEarnings).toEqual([-5_000]);
    expect(section.balancedByDate).toEqual([true]);
  });

  test('void entries are excluded from meaning', () => {
    const withVoid = [
      ...ENTRIES,
      makeEntry(
        'v1',
        '2025-05-01',
        [
          ['Assets:Cash', 1_000_000],
          ['Equity:Capital', -1_000_000],
        ],
        'void'
      ),
    ];
    const [section] = deriveBalanceSheet(withVoid, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    expect(section.totalAssets).toEqual([178_000]);
  });

  test('unclassified balances are surfaced and the equation honestly breaks', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-06-01', [
        ['Suspense:Unknown', 4_000],
        ['Assets:Cash', -4_000],
      ]),
    ];
    const [section] = deriveBalanceSheet(withSuspense, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    }).sections;
    expect(section.unclassified).toEqual([
      { account: 'Suspense:Unknown', amounts: [4_000] },
    ]);
    // The 4k sits outside every section, so the statement must not claim
    // to balance — flagged, never plugged.
    expect(section.balancedByDate).toEqual([false]);
  });

  test('dates before all activity yield zero columns that still balance', () => {
    const [section] = deriveBalanceSheet(ENTRIES, {
      dates: [
        { label: 'pre', asOf: '2023-12-31' },
        { label: 'FY2025', asOf: '2025-12-31' },
      ],
      taxonomy,
    }).sections;
    const cash = section.assets.find((line) => line.account === 'Assets:Cash');
    expect(cash?.amounts[0]).toBe(0);
    expect(section.balancedByDate).toEqual([true, true]);
  });

  test('multi-currency positions yield one section per currency', () => {
    const multi = [
      ...ENTRIES,
      makeEntry('u1', '2025-02-15', [
        ['Assets:Bank:Wise', 900, 'USD'],
        ['Income:Export', -900, 'USD'],
      ]),
    ];
    const data = deriveBalanceSheet(multi, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    });
    expect(data.sections.map((section) => section.currency)).toEqual([
      'MYR',
      'USD',
    ]);
    expect(data.sections[1].totalAssets).toEqual([900]);
    expect(data.sections[1].retainedEarnings).toEqual([900]);
    expect(data.sections[1].balancedByDate).toEqual([true]);
  });
});
