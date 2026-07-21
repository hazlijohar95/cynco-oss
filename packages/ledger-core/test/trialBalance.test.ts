import { describe, expect, test } from 'bun:test';

import { createAccountTaxonomy } from '../src/taxonomy';
import { deriveTrialBalance } from '../src/trialBalance';
import type { EntryFlag, LedgerEntry, Posting } from '../src/types';

function makeEntry(
  id: string,
  date: string,
  postings: Array<[account: string, amount: number, currency?: string]>,
  overrides: Partial<Pick<LedgerEntry, 'flag' | 'tags'>> = {}
): LedgerEntry {
  return {
    id,
    date,
    flag: overrides.flag ?? ('cleared' as EntryFlag),
    payee: null,
    narration: '',
    tags: overrides.tags ?? [],
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
  makeEntry('e1', '2025-01-01', [
    ['Assets:Cash', 100_000],
    ['Equity:Opening-Balances', -100_000],
  ]),
  makeEntry('e2', '2025-02-01', [
    ['Assets:Cash', 40_000],
    ['Income:Sales', -40_000],
  ]),
  makeEntry('e3', '2025-03-01', [
    ['Expenses:Rent', 12_000],
    ['Assets:Cash', -12_000],
  ]),
  makeEntry('e4', '2025-03-15', [
    ['Liabilities:Payables', -5_000],
    ['Expenses:Utilities', 5_000],
  ]),
];

describe('deriveTrialBalance', () => {
  test('splits signed balances into debit/credit and proves the tie', () => {
    const [section] = deriveTrialBalance(ENTRIES, { taxonomy }).sections;
    expect(section.currency).toBe('MYR');
    expect(section.totalDebit).toBe(145_000);
    expect(section.totalCredit).toBe(145_000);
    expect(section.balanced).toBe(true);

    const byAccount = new Map(
      section.rows.map((row) => [row.account, row.balance])
    );
    expect(byAccount.get('Assets:Cash')).toBe(128_000);
    expect(byAccount.get('Income:Sales')).toBe(-40_000);
    expect(byAccount.get('Liabilities:Payables')).toBe(-5_000);
  });

  test('rows follow statement order: assets, liabilities, equity, income, expenses', () => {
    const [section] = deriveTrialBalance(ENTRIES, { taxonomy }).sections;
    expect(section.rows.map((row) => row.account)).toEqual([
      'Assets:Cash',
      'Liabilities:Payables',
      'Equity:Opening-Balances',
      'Income:Sales',
      'Expenses:Rent',
      'Expenses:Utilities',
    ]);
  });

  test('asOf scopes the balances to that day inclusive', () => {
    const [section] = deriveTrialBalance(ENTRIES, {
      taxonomy,
      asOf: '2025-02-01',
    }).sections;
    const byAccount = new Map(
      section.rows.map((row) => [row.account, row.balance])
    );
    expect(byAccount.get('Assets:Cash')).toBe(140_000);
    expect(byAccount.has('Expenses:Rent')).toBe(false);
    expect(section.balanced).toBe(true);
  });

  test('void entries are excluded from meaning', () => {
    const withVoid = [
      ...ENTRIES,
      makeEntry(
        'v1',
        '2025-03-20',
        [
          ['Assets:Cash', 9_999],
          ['Income:Sales', -9_999],
        ],
        { flag: 'void' }
      ),
    ];
    const [section] = deriveTrialBalance(withVoid, { taxonomy }).sections;
    expect(section.totalDebit).toBe(145_000);
  });

  test('an unbalanced ledger reports balanced: false, never repaired', () => {
    const unbalanced = [
      ...ENTRIES,
      makeEntry('bad', '2025-03-30', [['Assets:Cash', 777]]),
    ];
    const [section] = deriveTrialBalance(unbalanced, { taxonomy }).sections;
    expect(section.balanced).toBe(false);
    expect(section.totalDebit - section.totalCredit).toBe(777);
  });

  test('abnormal balances are flagged against the normal balance', () => {
    const overdrawn = [
      makeEntry('o1', '2025-01-01', [
        ['Assets:Bank', -500],
        ['Expenses:Fees', 500],
      ]),
    ];
    const [section] = deriveTrialBalance(overdrawn, { taxonomy }).sections;
    const bank = section.rows.find((row) => row.account === 'Assets:Bank');
    const fees = section.rows.find((row) => row.account === 'Expenses:Fees');
    expect(bank?.abnormal).toBe(true);
    expect(fees?.abnormal).toBe(false);
  });

  test('unclassified accounts sort last and are never guessed', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-03-31', [
        ['Suspense:Unknown', 250],
        ['Assets:Cash', -250],
      ]),
    ];
    const [section] = deriveTrialBalance(withSuspense, { taxonomy }).sections;
    const last = section.rows[section.rows.length - 1];
    expect(last.account).toBe('Suspense:Unknown');
    expect(last.classification).toBeNull();
    expect(last.abnormal).toBe(false);
  });

  test('multi-currency ledgers yield one section per currency, sorted', () => {
    const multi = [
      ...ENTRIES,
      makeEntry('u1', '2025-02-10', [
        ['Assets:Bank:Wise', 900, 'USD'],
        ['Income:Export', -900, 'USD'],
      ]),
    ];
    const data = deriveTrialBalance(multi, { taxonomy });
    expect(data.sections.map((section) => section.currency)).toEqual([
      'MYR',
      'USD',
    ]);
    expect(data.sections[1].totalDebit).toBe(900);
    expect(data.sections[1].balanced).toBe(true);
  });

  test('working trial balance splits unadjusted, adjustment, adjusted', () => {
    const withAdjustment = [
      ...ENTRIES,
      makeEntry(
        'adj1',
        '2025-03-31',
        [
          ['Expenses:Depreciation', 2_000],
          ['Assets:Accumulated-Depreciation', -2_000],
        ],
        { tags: ['adjustment'] }
      ),
    ];
    const [section] = deriveTrialBalance(withAdjustment, {
      taxonomy,
      adjustments: { tag: 'adjustment' },
    }).sections;
    const depreciation = section.rows.find(
      (row) => row.account === 'Expenses:Depreciation'
    );
    expect(depreciation?.unadjusted).toBe(0);
    expect(depreciation?.adjustment).toBe(2_000);
    expect(depreciation?.balance).toBe(2_000);
    const cash = section.rows.find((row) => row.account === 'Assets:Cash');
    expect(cash?.unadjusted).toBe(128_000);
    expect(cash?.adjustment).toBe(0);
  });

  test('without adjustments the working columns are null', () => {
    const [section] = deriveTrialBalance(ENTRIES, { taxonomy }).sections;
    expect(section.rows[0].unadjusted).toBeNull();
    expect(section.rows[0].adjustment).toBeNull();
  });

  test('zero-activity chart accounts appear when requested', () => {
    const [section] = deriveTrialBalance(ENTRIES, {
      taxonomy,
      accountPaths: ['Assets:Bank:Maybank'],
    }).sections;
    const zero = section.rows.find(
      (row) => row.account === 'Assets:Bank:Maybank'
    );
    expect(zero?.balance).toBe(0);
    expect(zero?.abnormal).toBe(false);
  });

  test('no entries yields no sections', () => {
    expect(deriveTrialBalance([], { taxonomy }).sections).toEqual([]);
  });

  test('unsafe posting amounts are skipped like sumPostingsByCurrency', () => {
    const withBad = [
      ...ENTRIES,
      makeEntry('b1', '2025-03-31', [
        ['Assets:Cash', 0.5],
        ['Income:Sales', -0.5],
      ]),
    ];
    const [section] = deriveTrialBalance(withBad, { taxonomy }).sections;
    expect(section.totalDebit).toBe(145_000);
  });
});
