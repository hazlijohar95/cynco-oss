import { describe, expect, test } from 'bun:test';

import {
  createAccountTaxonomy,
  deriveBalanceSheet,
  renderBalanceSheetHTML,
} from '../src/index';
import type { LedgerEntry, Posting } from '../src/index';

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

const taxonomy = createAccountTaxonomy();

const ENTRIES: LedgerEntry[] = [
  makeEntry('e1', '2024-01-01', [
    ['Assets:Cash', 100_000],
    ['Equity:Capital', -100_000],
  ]),
  makeEntry('e2', '2024-06-01', [
    ['Assets:Cash', 8_000],
    ['Income:Sales', -8_000],
  ]),
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

describe('renderBalanceSheetHTML', () => {
  test('renders the three groups, computed retained earnings, and both proof totals', () => {
    const data = deriveBalanceSheet(ENTRIES, {
      dates: [{ label: '31 Dec 2025', asOf: '2025-12-31' }],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain('<div data-balance-sheet>');
    expect(html).toContain('Balance Sheet \u2014 MYR');
    expect(html).toContain('data-balanced="true"');
    expect(html).toContain('<tbody data-group="assets">');
    expect(html).toContain('<tbody data-group="liabilities">');
    expect(html).toContain('<tbody data-group="equity">');
    // Assets 1,780.00; Liabilities 500.00; Equity 1,280.00 (incl. 280.00 retained).
    expect(html).toContain(
      'data-total="assets"><th scope="row" data-cell="total-label">Total Assets</th><td data-cell="date-0">1,780.00</td>'
    );
    expect(html).toContain(
      'data-computed="retained-earnings"><th scope="row" data-cell="account">Retained earnings</th><td data-cell="date-0">280.00</td>'
    );
    expect(html).toContain(
      'data-total="equity"><th scope="row" data-cell="total-label">Total Equity</th><td data-cell="date-0">1,280.00</td>'
    );
    expect(html).toContain(
      'data-total="liabilities-equity"><th scope="row" data-cell="total-label">Total Liabilities &amp; Equity</th><td data-cell="date-0">1,780.00</td>'
    );
    expect(html).not.toContain('data-imbalance');
  });

  test('fiscal-year split renders the current-year earnings row', () => {
    const data = deriveBalanceSheet(ENTRIES, {
      dates: [
        {
          label: 'FY2025',
          asOf: '2025-12-31',
          fiscalYearStart: '2025-01-01',
        },
      ],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain(
      'data-computed="retained-earnings"><th scope="row" data-cell="account">Retained earnings</th><td data-cell="date-0">80.00</td>'
    );
    expect(html).toContain(
      'data-computed="current-earnings"><th scope="row" data-cell="account">Current year earnings</th><td data-cell="date-0">200.00</td>'
    );
  });

  test('without a fiscal-year split the current-earnings row is omitted', () => {
    const data = deriveBalanceSheet(ENTRIES, {
      dates: [{ label: '31 Dec 2025', asOf: '2025-12-31' }],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).not.toContain('data-computed="current-earnings"');
  });

  test('a fiscal-year column at break-even still states the zero', () => {
    const breakEven = [
      makeEntry('b1', '2025-01-01', [
        ['Assets:Cash', 1_000],
        ['Equity:Capital', -1_000],
      ]),
    ];
    const data = deriveBalanceSheet(breakEven, {
      dates: [
        { label: 'FY2025', asOf: '2025-12-31', fiscalYearStart: '2025-01-01' },
      ],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain(
      'data-computed="current-earnings"><th scope="row" data-cell="account">Current year earnings</th><td data-cell="date-0">0.00</td>'
    );
  });

  test('comparative dates render one labeled column each', () => {
    const data = deriveBalanceSheet(ENTRIES, {
      dates: [
        { label: 'FY2024', asOf: '2024-12-31' },
        { label: 'FY2025', asOf: '2025-12-31' },
      ],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain('data-column="date-0">FY2024</th>');
    expect(html).toContain('data-column="date-1">FY2025</th>');
    expect(html).toContain(
      'data-account="Assets:Cash"><th scope="row" data-cell="account">Assets:Cash</th><td data-cell="date-0">1,080.00</td><td data-cell="date-1">1,780.00</td>'
    );
  });

  test('unclassified residue breaks the equation visibly, never plugged', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-06-01', [
        ['Suspense:Unknown', 4_000],
        ['Assets:Cash', -4_000],
      ]),
    ];
    const data = deriveBalanceSheet(withSuspense, {
      dates: [{ label: 'FY2025', asOf: '2025-12-31' }],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain('data-balanced="false"');
    expect(html).toContain('<tbody data-group="unclassified">');
    expect(html).toContain('<tr data-imbalance>');
    // Assets 1,740.00 vs L+E 1,780.00 → −40.00 with an explicit sign.
    expect(html).toContain('<span data-imbalance-amount>\u221240.00</span>');
  });

  test('imbalance row leaves balanced comparative columns blank', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-06-01', [
        ['Suspense:Unknown', 4_000],
        ['Assets:Cash', -4_000],
      ]),
    ];
    const data = deriveBalanceSheet(withSuspense, {
      dates: [
        { label: 'FY2024', asOf: '2024-12-31' },
        { label: 'FY2025', asOf: '2025-12-31' },
      ],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain(
      '<tr data-imbalance><th scope="row" data-cell="imbalance-label">Out of balance</th><td data-cell="date-0"></td><td data-cell="date-1"><span data-imbalance-amount>'
    );
  });

  test('multi-currency positions render one section per currency', () => {
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
    const html = renderBalanceSheetHTML(data);
    expect(html).toContain('Balance Sheet \u2014 MYR');
    expect(html).toContain('Balance Sheet \u2014 USD');
  });

  test('escapes HTML in account paths and date labels', () => {
    const nasty = [
      makeEntry('x1', '2025-01-10', [
        ['Assets:<img src=x>', 100],
        ['Equity:Capital', -100],
      ]),
    ];
    const data = deriveBalanceSheet(nasty, {
      dates: [{ label: '<i>now</i>', asOf: '2025-12-31' }],
      taxonomy,
    });
    const html = renderBalanceSheetHTML(data);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<i>now</i>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});
