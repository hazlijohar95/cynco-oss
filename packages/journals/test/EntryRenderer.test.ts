import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { MINUS_SIGN } from '../src/constants';
import { renderEntryHTML } from '../src/renderers/EntryRenderer';
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

// Compact behavioral projection of posting rows: account path, +/− derived
// from the data attribute, unsigned amount, currency.
function projectPostings(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('[data-posting]')).map((posting) => {
    const account = posting.querySelector('[data-cell="account"]');
    const amount = posting.querySelector('[data-amount-value]');
    const currency = posting.querySelector('[data-cell="currency"]');
    const sign =
      posting.getAttribute('data-amount') === 'credit' ? MINUS_SIGN : '+';
    return `${account?.textContent} ${sign}${amount?.textContent} ${currency?.textContent}`;
  });
}

describe('renderEntryHTML', () => {
  test('renders header metadata: date, flag dot, payee, narration, tags, links', () => {
    const root = parse(renderEntryHTML(makeEntry()));
    expect(root.getAttribute('data-flag')).toBe('cleared');
    expect(root.querySelector('[data-date]')?.textContent).toBe('2026-07-18');
    const dot = root.querySelector('[data-flag-dot]');
    expect(dot?.getAttribute('data-flag')).toBe('cleared');
    expect(dot?.textContent).toBe('\u25cf');
    expect(root.querySelector('[data-payee]')?.textContent).toBe(
      'Acme Sdn Bhd'
    );
    expect(root.querySelector('[data-narration]')?.textContent).toBe(
      'Monthly consulting invoice'
    );
    expect(root.querySelector('[data-tag]')?.textContent).toBe('#ops');
    expect(root.querySelector('[data-link]')?.textContent).toBe('^inv-42');
  });

  test('posting rows project account, sign, amount, and currency', () => {
    const root = parse(renderEntryHTML(makeEntry()));
    expect(projectPostings(root)).toEqual([
      'Assets:Current:Cash-Maybank +1,500.00 MYR',
      `Income:Sales:Consulting ${MINUS_SIGN}1,500.00 MYR`,
    ]);
  });

  test('account paths split segments with punctuation-colored separators', () => {
    const root = parse(renderEntryHTML(makeEntry()));
    const account = root.querySelector('[data-cell="account"]');
    const segments = Array.from(
      account?.querySelectorAll('[data-account-segment]') ?? []
    ).map((segment) => segment.textContent);
    expect(segments).toEqual(['Assets', 'Current', 'Cash-Maybank']);
    expect(account?.querySelectorAll('[data-account-separator]').length).toBe(
      2
    );
  });

  test('null payee and empty narration are omitted', () => {
    const root = parse(
      renderEntryHTML(
        makeEntry({ payee: null, narration: '', tags: [], links: [] })
      )
    );
    expect(root.querySelector('[data-payee]')).toBeNull();
    expect(root.querySelector('[data-narration]')).toBeNull();
    expect(root.querySelector('[data-tag]')).toBeNull();
    expect(root.querySelector('[data-link]')).toBeNull();
  });

  test('balanced entries render no footer', () => {
    const root = parse(renderEntryHTML(makeEntry()));
    expect(root.querySelector('[data-entry-footer]')).toBeNull();
    expect(root.querySelector('[data-imbalance]')).toBeNull();
  });

  test('unbalanced entries render a checker bar and signed imbalance per currency', () => {
    const root = parse(
      renderEntryHTML(
        makeEntry({
          postings: [
            { account: 'Assets:Cash', amount: 10_000, currency: 'MYR' },
            { account: 'Income:Sales', amount: -9_999, currency: 'MYR' },
            { account: 'Assets:Cash-USD', amount: 500, currency: 'USD' },
          ],
        })
      )
    );
    const imbalances = Array.from(root.querySelectorAll('[data-imbalance]'));
    expect(imbalances.length).toBe(2);
    expect(imbalances[0].querySelector('[data-imbalance-bar]')).not.toBeNull();
    expect(
      imbalances.map(
        (imbalance) =>
          imbalance.querySelector('[data-imbalance-amount]')?.textContent
      )
    ).toEqual(['+0.01 MYR', '+5.00 USD']);
  });

  test('showLineNumbers adds the grid attribute and 1-based number cells', () => {
    const root = parse(renderEntryHTML(makeEntry(), { showLineNumbers: true }));
    expect(root.hasAttribute('data-line-numbers')).toBe(true);
    const numbers = Array.from(
      root.querySelectorAll('[data-cell="number"]')
    ).map((cell) => cell.textContent);
    expect(numbers).toEqual(['1', '2']);
  });

  test('escapes payee, narration, tags, and account text', () => {
    const root = parse(
      renderEntryHTML(
        makeEntry({
          payee: '<script>alert(1)</script>',
          narration: 'a & b "c"',
          tags: ['<b>'],
          postings: [
            { account: 'Assets:<Cash>', amount: 100, currency: 'MYR' },
            { account: 'Income:Sales', amount: -100, currency: 'MYR' },
          ],
        })
      )
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('[data-payee]')?.textContent).toBe(
      '<script>alert(1)</script>'
    );
    expect(root.querySelector('[data-narration]')?.textContent).toBe(
      'a & b "c"'
    );
    expect(root.querySelector('[data-tag]')?.textContent).toBe('#<b>');
    expect(root.querySelector('[data-cell="account"]')?.textContent).toBe(
      'Assets:<Cash>'
    );
  });

  // An untyped JS host can bypass the EntryFlag union and hand us an arbitrary
  // string. The flag lands unescaped-looking in three attributes plus the
  // article's data-flag, so it must be escaped the same way every text field
  // is — otherwise it breaks out of the attribute and injects markup.
  test('escapes a malicious flag from an untyped host (XSS)', () => {
    const root = parse(
      renderEntryHTML(
        makeEntry({
          flag: '"><img src=x onerror=alert(1)>' as never,
        })
      )
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.getAttribute('data-flag')).toBe(
      '"><img src=x onerror=alert(1)>'
    );
    const dot = root.querySelector('[data-flag-dot]');
    expect(dot?.getAttribute('data-flag')).toBe(
      '"><img src=x onerror=alert(1)>'
    );
    expect(dot?.getAttribute('title')).toBe('"><img src=x onerror=alert(1)>');
    expect(dot?.getAttribute('aria-label')).toBe(
      '"><img src=x onerror=alert(1)>'
    );
  });

  // Single full-fidelity canary: any intentional markup change must update
  // this snapshot, everything else stays behavioral projections.
  test('full HTML snapshot canary', () => {
    expect(
      renderEntryHTML(makeEntry(), { showLineNumbers: true })
    ).toMatchSnapshot();
  });
});
