import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { renderEntryDiffHTML } from '../src/renderers/EntryDiffRenderer';
import type { LedgerEntry } from '../src/types';
import { diffEntryVersions } from '../src/utils/diffEntryVersions';
import { type DomHandle, installDom, makeEntry } from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

// Parses renderer output through jsdom so assertions run against the DOM the
// client component would produce via innerHTML.
function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error('parse: renderer produced no element');
  }
  return first;
}

// Representative audit-trail fixture: amount change, narration word change,
// added posting, tag swap.
function makeBefore(): LedgerEntry {
  return makeEntry({
    narration: 'Monthly consulting invoice',
    tags: ['ops', 'legacy'],
    postings: [
      {
        account: 'Assets:Current:Cash-Maybank',
        amount: 150_000,
        currency: 'MYR',
      },
      {
        account: 'Income:Sales:Consulting',
        amount: -150_000,
        currency: 'MYR',
      },
    ],
  });
}

function makeAfter(): LedgerEntry {
  return makeEntry({
    narration: 'Monthly retainer invoice',
    tags: ['ops'],
    postings: [
      {
        account: 'Assets:Current:Cash-Maybank',
        amount: 149_000,
        currency: 'MYR',
      },
      {
        account: 'Income:Sales:Consulting',
        amount: -150_000,
        currency: 'MYR',
      },
      { account: 'Expenses:Bank:Fees', amount: 1_000, currency: 'MYR' },
    ],
  });
}

describe('renderEntryDiffHTML', () => {
  test('amount-changed postings show the old amount struck through before the new one', () => {
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    );
    const changed = root.querySelector('[data-posting-diff="amount-changed"]');
    expect(changed).not.toBeNull();
    expect(changed?.querySelector('[data-amount-old]')?.textContent).toBe(
      '1,500.00'
    );
    expect(changed?.querySelector('[data-amount-value]')?.textContent).toBe(
      '1,490.00'
    );
  });

  test('added and removed postings carry their diff family attributes', () => {
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    );
    const added = root.querySelector('[data-posting-diff="added"]');
    expect(added?.querySelector('[data-cell="account"]')?.textContent).toBe(
      'Expenses:Bank:Fees'
    );
    expect(
      root.querySelector('[data-posting-diff="unchanged"]')
    ).not.toBeNull();

    const deletion = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), null))
    );
    expect(
      deletion.querySelectorAll('[data-posting-diff="removed"]').length
    ).toBe(2);
    expect(deletion.getAttribute('data-diff-kind')).toBe('deleted');
  });

  test('changed narration renders word-level highlight spans on both sides', () => {
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    );
    const field = root.querySelector('[data-diff-field="narration"]');
    expect(field?.getAttribute('data-field-kind')).toBe('changed');
    expect(
      field?.querySelector('[data-diff-old] [data-diff-word]')?.textContent
    ).toBe('consulting');
    expect(
      field?.querySelector('[data-diff-new] [data-diff-word]')?.textContent
    ).toBe('retainer');
    // The unchanged run stays outside the highlight span.
    expect(
      field?.querySelector('[data-diff-new] [data-narration]')?.textContent
    ).toBe('Monthly retainer invoice');
  });

  test('tag pills classify per item', () => {
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    );
    const pills = Array.from(
      root.querySelectorAll('[data-diff-field="tags"] [data-tag]')
    ).map(
      (pill) => `${pill.getAttribute('data-diff-item')}:${pill.textContent}`
    );
    expect(pills).toEqual(['unchanged:#ops', 'removed:#legacy']);
  });

  test('unbalanced AFTER version gets the standard imbalance footer', () => {
    const unbalancedAfter = makeEntry({
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 150_000,
          currency: 'MYR',
        },
        {
          account: 'Income:Sales:Consulting',
          amount: -149_999,
          currency: 'MYR',
        },
      ],
    });
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), unbalancedAfter))
    );
    expect(root.querySelector('[data-entry-footer]')).not.toBeNull();
    expect(root.querySelector('[data-imbalance-amount]')?.textContent).toBe(
      '+0.01 MYR'
    );
    // Balanced pairs render no footer.
    const balanced = parse(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    );
    expect(balanced.querySelector('[data-entry-footer]')).toBeNull();
  });

  test('escapes payee, narration, and account text (XSS)', () => {
    const root = parse(
      renderEntryDiffHTML(
        diffEntryVersions(
          makeEntry({ payee: '<script>alert(1)</script>' }),
          makeEntry({
            payee: '<img src=x onerror=alert(1)>',
            narration: 'a & b "c"',
            postings: [
              { account: 'Assets:<Cash>', amount: 100, currency: 'MYR' },
              { account: 'Income:Sales', amount: -100, currency: 'MYR' },
            ],
          })
        )
      )
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(
      root.querySelector('[data-diff-old] [data-payee]')?.textContent
    ).toBe('<script>alert(1)</script>');
    expect(
      root.querySelector('[data-diff-new] [data-payee]')?.textContent
    ).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('[data-cell="account"]')?.textContent).toBe(
      'Assets:<Cash>'
    );
  });

  test('creation renders every field and posting as added', () => {
    const root = parse(
      renderEntryDiffHTML(diffEntryVersions(null, makeEntry()))
    );
    expect(root.getAttribute('data-diff-kind')).toBe('created');
    expect(root.querySelectorAll('[data-posting-diff="added"]').length).toBe(2);
    expect(root.querySelector('[data-diff-old]')).toBeNull();
  });

  // Single full-fidelity canary: any intentional markup change must update
  // this snapshot, everything else stays behavioral projections.
  test('full HTML snapshot canary', () => {
    expect(
      renderEntryDiffHTML(diffEntryVersions(makeBefore(), makeAfter()))
    ).toMatchSnapshot();
  });
});
