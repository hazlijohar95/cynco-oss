import { describe, expect, test } from 'bun:test';

import {
  createAccountTaxonomy,
  deriveIncomeStatement,
  renderIncomeStatementHTML,
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

const taxonomy = createAccountTaxonomy({
  overrides: { 'Income:Sales-Returns': { contra: true } },
});

const ENTRIES: LedgerEntry[] = [
  makeEntry('e1', '2025-01-10', [
    ['Assets:Cash', 40_000],
    ['Income:Sales', -40_000],
  ]),
  makeEntry('e2', '2025-01-20', [
    ['Income:Sales-Returns', 3_000],
    ['Assets:Cash', -3_000],
  ]),
  makeEntry('e3', '2025-01-31', [
    ['Expenses:Rent', 12_000],
    ['Assets:Cash', -12_000],
  ]),
  makeEntry('e4', '2025-02-10', [
    ['Assets:Cash', 25_000],
    ['Income:Sales', -25_000],
  ]),
];

const JAN = { label: 'Jan 2025', dateFrom: '2025-01-01', dateTo: '2025-01-31' };
const FEB = { label: 'Feb 2025', dateFrom: '2025-02-01', dateTo: '2025-02-28' };

describe('renderIncomeStatementHTML', () => {
  test('renders income and expense groups with totals and net income', () => {
    const data = deriveIncomeStatement(ENTRIES, {
      periods: [JAN],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    expect(html).toContain('<div data-income-statement>');
    expect(html).toContain('data-currency="MYR"');
    expect(html).toContain('Income Statement \u2014 MYR');
    expect(html).toContain('<tbody data-group="income">');
    expect(html).toContain('<tbody data-group="expenses">');
    expect(html).toContain('data-total="income"');
    expect(html).toContain('data-total="expenses"');
    expect(html).toContain('<tr data-net-income>');
    // Jan: 40k − 3k returns = 37k income, 12k expenses, 25k net.
    expect(html).toContain('>370.00</td>');
    expect(html).toContain('>120.00</td>');
    expect(html).toContain('>250.00</td>');
  });

  test('contra income renders with the proper minus sign inside income', () => {
    const data = deriveIncomeStatement(ENTRIES, {
      periods: [JAN],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    // U+2212, not ASCII hyphen; presentation flip already applied upstream.
    expect(html).toContain(
      'data-account="Income:Sales-Returns"><th scope="row" data-cell="account">Income:Sales-Returns</th><td data-cell="period-0">\u221230.00</td>'
    );
  });

  test('comparative periods render one labeled column each', () => {
    const data = deriveIncomeStatement(ENTRIES, {
      periods: [JAN, FEB],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    expect(html).toContain('data-column="period-0">Jan 2025</th>');
    expect(html).toContain('data-column="period-1">Feb 2025</th>');
    // Sales line carries one amount per column.
    expect(html).toContain(
      '<td data-cell="period-0">400.00</td><td data-cell="period-1">250.00</td>'
    );
  });

  test('zero line cells render empty; proof lines always state values', () => {
    const data = deriveIncomeStatement(ENTRIES, {
      periods: [JAN, FEB],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    // Rent has no Feb activity: blank cell on the line…
    expect(html).toContain(
      'data-account="Expenses:Rent"><th scope="row" data-cell="account">Expenses:Rent</th><td data-cell="period-0">120.00</td><td data-cell="period-1"></td>'
    );
    // …but Total Expenses states the zero.
    expect(html).toContain(
      'data-total="expenses"><th scope="row" data-cell="total-label">Total Expenses</th><td data-cell="period-0">120.00</td><td data-cell="period-1">0.00</td>'
    );
  });

  test('unclassified activity renders as a flagged group', () => {
    const withSuspense = [
      ...ENTRIES,
      makeEntry('s1', '2025-01-15', [
        ['Suspense:Unknown', -700],
        ['Assets:Cash', 700],
      ]),
    ];
    const data = deriveIncomeStatement(withSuspense, {
      periods: [JAN],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    expect(html).toContain('<tbody data-group="unclassified">');
    expect(html).toContain('data-unclassified data-account="Suspense:Unknown"');
    // Ledger-signed, no presentation flip.
    expect(html).toContain('\u22127.00');
  });

  test('multi-currency data renders one section per currency', () => {
    const multi = [
      ...ENTRIES,
      makeEntry('u1', '2025-01-15', [
        ['Assets:Bank:Wise', 900, 'USD'],
        ['Income:Export', -900, 'USD'],
      ]),
    ];
    const data = deriveIncomeStatement(multi, { periods: [JAN], taxonomy });
    const html = renderIncomeStatementHTML(data);
    expect(html).toContain('data-currency="MYR"');
    expect(html).toContain('data-currency="USD"');
    expect(html).toContain('Income Statement \u2014 USD');
  });

  test('escapes HTML in account paths and period labels', () => {
    const nasty = [
      makeEntry('x1', '2025-01-10', [
        ['Income:<script>', -100],
        ['Assets:Cash', 100],
      ]),
    ];
    const data = deriveIncomeStatement(nasty, {
      periods: [
        { label: '<b>Jan</b>', dateFrom: '2025-01-01', dateTo: '2025-01-31' },
      ],
      taxonomy,
    });
    const html = renderIncomeStatementHTML(data);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Jan</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Jan&lt;/b&gt;');
  });
});
