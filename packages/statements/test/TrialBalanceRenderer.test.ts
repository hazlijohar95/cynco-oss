import {
  createAccountTaxonomy,
  deriveTrialBalance,
  type LedgerEntry,
  type Posting,
} from '@cynco/ledger-core';
import { describe, expect, test } from 'bun:test';

import { MINUS_SIGN } from '../src/constants';
import { renderTrialBalanceHTML } from '../src/renderers/TrialBalanceRenderer';

// Pure string tests: the renderer is a DOM-free string builder, so the
// assertions read the emitted HTML directly — the same discipline the
// data- attribute contract exists for.

let nextId = 0;

function makeEntry(
  postings: readonly Posting[],
  overrides: Partial<LedgerEntry> = {}
): LedgerEntry {
  nextId += 1;
  return {
    id: `entry-${nextId}`,
    date: '2026-06-15',
    flag: 'cleared',
    payee: null,
    narration: 'test entry',
    tags: [],
    links: [],
    postings,
    ...overrides,
  };
}

const taxonomy = createAccountTaxonomy();

describe('renderTrialBalanceHTML', () => {
  test('balanced section renders totals with data-balanced="true"', () => {
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Cash', amount: 128_000, currency: 'MYR' },
          { account: 'Income:Sales', amount: -128_000, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain('<div data-trial-balance>');
    expect(html).toContain('data-currency="MYR"');
    expect(html).toContain('data-balanced="true"');
    expect(html).toContain('<tr data-totals data-balanced="true">');
    expect(html).toContain('data-total="debit">1,280.00</td>');
    expect(html).toContain('data-total="credit">1,280.00</td>');
    expect(html).not.toContain('data-imbalance');
  });

  test('unbalanced section renders a flagged imbalance row with the difference', () => {
    // Deliberately unbalanced input: the renderer must flag, never repair.
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Cash', amount: 10_000, currency: 'MYR' },
          { account: 'Income:Sales', amount: -9_999, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain('data-balanced="false"');
    expect(html).toContain('<tr data-imbalance>');
    expect(html).toContain('+0.01 MYR');
  });

  test('debit/credit column placement follows the balance sign', () => {
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Cash', amount: 4_550, currency: 'MYR' },
          { account: 'Income:Sales', amount: -4_550, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data);
    // Positive balance fills the debit cell, credit cell stays empty.
    expect(html).toContain(
      '<td data-cell="debit">45.50</td><td data-cell="credit"></td>'
    );
    // Negative balance fills the credit cell with the negated magnitude.
    expect(html).toContain(
      '<td data-cell="debit"></td><td data-cell="credit">45.50</td>'
    );
    // Column semantics carry the sign — no minus glyph inside the body.
    expect(html).not.toContain(MINUS_SIGN);
  });

  test('abnormal rows carry data-abnormal', () => {
    // Assets:Overdrawn ends up credit-heavy: a debit-normal account holding
    // a credit balance is the classic review flag.
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Overdrawn', amount: -5_000, currency: 'MYR' },
          { account: 'Assets:Cash', amount: 5_000, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain(
      '<tr data-row data-account="Assets:Overdrawn" data-abnormal>'
    );
    expect(html).toContain('<tr data-row data-account="Assets:Cash">');
  });

  test('unclassified rows carry data-unclassified', () => {
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Mystery:Box', amount: 100, currency: 'MYR' },
          { account: 'Assets:Cash', amount: -100, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain(
      '<tr data-row data-account="Mystery:Box" data-unclassified>'
    );
    expect(html).not.toContain('data-account="Assets:Cash" data-unclassified');
  });

  test('working-TB mode renders the six amount columns', () => {
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Cash', amount: 10_000, currency: 'MYR' },
          { account: 'Income:Sales', amount: -10_000, currency: 'MYR' },
        ]),
        makeEntry(
          [
            {
              account: 'Expenses:Depreciation',
              amount: 2_500,
              currency: 'MYR',
            },
            { account: 'Assets:Cash', amount: -2_500, currency: 'MYR' },
          ],
          { tags: ['adjustment'] }
        ),
      ],
      { taxonomy, adjustments: { tag: 'adjustment' } }
    );
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain(' data-working');
    for (const column of [
      'unadjusted-debit',
      'unadjusted-credit',
      'adjustments-debit',
      'adjustments-credit',
      'adjusted-debit',
      'adjusted-credit',
    ]) {
      expect(html).toContain(`data-column="${column}"`);
    }
    // Cash: 10,000 unadjusted debit, 2,500 adjustment credit, 7,500 adjusted.
    expect(html).toContain('<td data-cell="unadjusted-debit">100.00</td>');
    expect(html).toContain('<td data-cell="adjustments-credit">25.00</td>');
    expect(html).toContain('<td data-cell="adjusted-debit">75.00</td>');
  });

  test('amounts format as digit strings with thousands separators', () => {
    const data = deriveTrialBalance([
      makeEntry([
        { account: 'Assets:Cash', amount: 128_000, currency: 'MYR' },
        { account: 'Income:Sales', amount: -128_000, currency: 'MYR' },
      ]),
    ]);
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain('1,280.00');
  });

  test('caption names the currency and the as-of date when bounded', () => {
    const entries = [
      makeEntry([
        { account: 'Assets:Cash', amount: 100, currency: 'MYR' },
        { account: 'Income:Sales', amount: -100, currency: 'MYR' },
      ]),
    ];
    const allTime = renderTrialBalanceHTML(deriveTrialBalance(entries));
    expect(allTime).toContain('Trial Balance \u2014 MYR');
    expect(allTime).not.toContain('data-as-of');

    const bounded = renderTrialBalanceHTML(
      deriveTrialBalance(entries, { asOf: '2026-06-30' })
    );
    expect(bounded).toContain('data-as-of="2026-06-30"');
    expect(bounded).toContain('<span data-as-of-date> as of 2026-06-30</span>');
  });

  test('HTML-escapes account names containing <>&', () => {
    const data = deriveTrialBalance([
      makeEntry([
        { account: 'Assets:<Cash> & "Co"', amount: 100, currency: 'MYR' },
        { account: 'Income:Sales', amount: -100, currency: 'MYR' },
      ]),
    ]);
    const html = renderTrialBalanceHTML(data);
    expect(html).not.toContain('<Cash>');
    expect(html).toContain('Assets:&lt;Cash&gt; &amp; &quot;Co&quot;');
  });

  test('multi-currency data renders one section per currency', () => {
    const data = deriveTrialBalance([
      makeEntry([
        { account: 'Assets:Cash', amount: 100, currency: 'MYR' },
        { account: 'Income:Sales', amount: -100, currency: 'MYR' },
      ]),
      makeEntry([
        { account: 'Assets:Cash-USD', amount: 500, currency: 'USD' },
        { account: 'Income:Sales', amount: -500, currency: 'USD' },
      ]),
    ]);
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain('data-currency="MYR"');
    expect(html).toContain('data-currency="USD"');
    expect(html.match(/<table data-section/g)?.length).toBe(2);
  });

  test('showClassification adds the type column with honest labels', () => {
    const data = deriveTrialBalance(
      [
        makeEntry([
          { account: 'Assets:Cash', amount: 100, currency: 'MYR' },
          { account: 'Mystery:Box', amount: -100, currency: 'MYR' },
        ]),
      ],
      { taxonomy }
    );
    const html = renderTrialBalanceHTML(data, { showClassification: true });
    expect(html).toContain('<th scope="col" data-column="type">Type</th>');
    expect(html).toContain('<td data-cell="type">asset</td>');
    expect(html).toContain('<td data-cell="type">unclassified</td>');
  });
});
