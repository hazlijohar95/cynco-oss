import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  AMOUNT_FORMAT_INDIAN,
  DEFAULT_REGISTER_EMPTY_LABEL,
  MINUS_SIGN,
} from '../src/constants';
import {
  finalRegisterBalances,
  renderRegisterEmptyStateHTML,
  renderRegisterHeaderHTML,
  renderRegisterHTML,
  renderRegisterRowHTML,
  renderRegisterRowsHTML,
} from '../src/renderers/RegisterRenderer';
import type { RegisterRowData } from '../src/types';
import { type DomHandle, installDom, makeEntry, makeRows } from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error('parse: renderer produced no element');
  }
  return first;
}

const ACCOUNT = 'Assets:Current:Cash-Maybank';

describe('renderRegisterRowHTML', () => {
  test('debit rows carry debit attributes and unsigned amounts', () => {
    const rows = makeRows(1);
    const row = parse(renderRegisterRowHTML(rows[0], 0, false));
    expect(row.getAttribute('data-amount')).toBe('debit');
    expect(row.getAttribute('data-row-index')).toBe('0');
    expect(
      row.querySelector('[data-amount-sign]')?.getAttribute('data-amount-sign')
    ).toBe('debit');
    expect(row.querySelector('[data-amount-value]')?.textContent).toBe(
      '100.00'
    );
  });

  test('credit rows carry credit attributes', () => {
    const rows = makeRows(3);
    const row = parse(renderRegisterRowHTML(rows[2], 2, false));
    expect(row.getAttribute('data-amount')).toBe('credit');
    expect(
      row.querySelector('[data-amount-sign]')?.getAttribute('data-amount-sign')
    ).toBe('credit');
    expect(row.querySelector('[data-amount-value]')?.textContent).toBe('25.00');
  });

  test('running balance column reflects the per-row balance map', () => {
    const rows = makeRows(3);
    const balances = rows.map((rowData, index) => {
      const row = parse(renderRegisterRowHTML(rowData, index, false));
      return row.querySelector('[data-balance-value]')?.textContent;
    });
    // 10000, +10001, -2500 => 100.00, 200.01, 175.01
    expect(balances).toEqual(['100.00', '200.01', '175.01']);
  });

  test('negative running balances get the balance-negative attribute', () => {
    const entry = makeEntry({
      postings: [
        { account: ACCOUNT, amount: -50_000, currency: 'MYR' },
        { account: 'Expenses:Rent', amount: 50_000, currency: 'MYR' },
      ],
    });
    const rowData: RegisterRowData = {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', -12_345]]),
    };
    const row = parse(renderRegisterRowHTML(rowData, 0, false));
    const balance = row.querySelector('[data-cell="balance"]');
    expect(balance?.getAttribute('data-balance-negative')).toBe('true');
    expect(balance?.querySelector('[data-balance-value]')?.textContent).toBe(
      `${MINUS_SIGN}123.45`
    );
  });

  test('missing balance currency renders an empty cell, never a made up number', () => {
    const entry = makeEntry();
    const rowData: RegisterRowData = {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map(),
    };
    const row = parse(renderRegisterRowHTML(rowData, 0, false));
    const balance = row.querySelector('[data-cell="balance"]');
    expect(balance).not.toBeNull();
    expect(balance?.textContent).toBe('');
  });

  test('selected rows carry the selection attribute', () => {
    const rows = makeRows(1);
    const row = parse(renderRegisterRowHTML(rows[0], 0, true));
    expect(row.getAttribute('data-row-selected')).toBe('true');
  });

  test('description lines carry full-text title attributes (truncation tooltips)', () => {
    // Both lines ellipsize in CSS and the pure renderer cannot know whether
    // clipping occurs, so the title is emitted unconditionally on both.
    const rows = makeRows(1);
    const row = parse(renderRegisterRowHTML(rows[0], 0, false));
    expect(row.querySelector('[data-payee]')?.getAttribute('title')).toBe(
      'Payee 0'
    );
    expect(row.querySelector('[data-narration]')?.getAttribute('title')).toBe(
      'Narration 0'
    );
  });

  test('promoted narration (payee-less entry) titles the primary line', () => {
    const entry = makeEntry({ payee: null, narration: 'Direct debit' });
    const rowData: RegisterRowData = {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', 10_000]]),
    };
    const row = parse(renderRegisterRowHTML(rowData, 0, false));
    expect(row.querySelector('[data-payee]')?.getAttribute('title')).toBe(
      'Direct debit'
    );
    expect(row.querySelector('[data-narration]')).toBeNull();
  });

  test('titles are HTML-escaped and never carry filter markup', () => {
    const entry = makeEntry({
      payee: '"Ampersand & Sons" <BHD>',
      narration: 'Invoice <mark>',
    });
    const rowData: RegisterRowData = {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', 10_000]]),
    };
    const row = parse(
      renderRegisterRowHTML(rowData, 0, false, 1, undefined, {
        lowerQuery: 'ampersand',
        fields: new Set(['description']),
      })
    );
    // getAttribute returns the decoded value: the raw text round-trips.
    expect(row.querySelector('[data-payee]')?.getAttribute('title')).toBe(
      '"Ampersand & Sons" <BHD>'
    );
    expect(row.querySelector('[data-narration]')?.getAttribute('title')).toBe(
      'Invoice <mark>'
    );
    // The visible line still carries the highlight; the attribute does not.
    expect(
      row.querySelector('[data-payee] mark[data-filter-match]')
    ).not.toBeNull();
    expect(row.querySelectorAll('mark').length).toBe(1);
  });

  test('escapes a malicious flag from an untyped host (XSS)', () => {
    const entry = makeEntry({
      flag: '"><img src=x onerror=alert(1)>' as never,
    });
    const rowData: RegisterRowData = {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', 10_000]]),
    };
    const row = parse(renderRegisterRowHTML(rowData, 0, false));
    expect(row.querySelector('img')).toBeNull();
    expect(row.getAttribute('data-flag')).toBe(
      '"><img src=x onerror=alert(1)>'
    );
    expect(
      row.querySelector('[data-flag-dot]')?.getAttribute('data-flag')
    ).toBe('"><img src=x onerror=alert(1)>');
  });
});

describe('renderRegisterRowsHTML', () => {
  test('renders exactly the [start, end) slice with absolute indices', () => {
    const rows = makeRows(10);
    const host = document.createElement('div');
    host.innerHTML = renderRegisterRowsHTML(rows, { start: 3, end: 6 }, 4);
    const indices = Array.from(host.querySelectorAll('[data-row]')).map((row) =>
      row.getAttribute('data-row-index')
    );
    expect(indices).toEqual(['3', '4', '5']);
    expect(
      host
        .querySelector('[data-row-index="4"]')
        ?.getAttribute('data-row-selected')
    ).toBe('true');
  });
});

describe('renderRegisterHeaderHTML', () => {
  test('sticky header shows the account path and current balances', () => {
    const header = parse(
      renderRegisterHeaderHTML(
        ACCOUNT,
        new Map([
          ['MYR', 175_01],
          ['USD', -5_000],
        ])
      )
    );
    expect(header.hasAttribute('data-sticky')).toBe(true);
    expect(header.querySelector('[data-account]')?.textContent).toBe(ACCOUNT);
    const balances = Array.from(
      header.querySelectorAll('[data-balance-amount]')
    );
    expect(balances.map((balance) => balance.textContent)).toEqual([
      '175.01 MYR',
      `${MINUS_SIGN}50.00 USD`,
    ]);
    expect(balances[1].getAttribute('data-balance-negative')).toBe('true');
  });

  test('empty registers render a header without balances', () => {
    const header = parse(renderRegisterHeaderHTML(ACCOUNT, null));
    expect(header.querySelector('[data-balance-amount]')).toBeNull();
  });
});

describe('finalRegisterBalances', () => {
  test('empty rows produce null', () => {
    expect(finalRegisterBalances([])).toBeNull();
  });

  test('collects the latest balance per currency across single-entry maps', () => {
    // The @cynco/ledger-core adapter shape: each row's map carries only the
    // posting's own currency. Reading only the LAST row would drop MYR here.
    const entry = makeEntry();
    const rows: RegisterRowData[] = [
      {
        entry,
        posting: entry.postings[0],
        runningBalance: new Map([['MYR', 10_000]]),
      },
      {
        entry,
        posting: entry.postings[0],
        runningBalance: new Map([['USD', -5_000]]),
      },
      {
        entry,
        posting: entry.postings[0],
        runningBalance: new Map([['MYR', 12_500]]),
      },
    ];
    const balances = finalRegisterBalances(rows);
    expect(balances).not.toBeNull();
    expect(Array.from(balances ?? [])).toEqual([
      ['MYR', 12_500],
      ['USD', -5_000],
    ]);
  });

  test('full per-currency maps behave like the last row', () => {
    const entry = makeEntry();
    const rows: RegisterRowData[] = [
      {
        entry,
        posting: entry.postings[0],
        runningBalance: new Map([
          ['MYR', 1_000],
          ['USD', 2_000],
        ]),
      },
      {
        entry,
        posting: entry.postings[0],
        runningBalance: new Map([
          ['MYR', 3_000],
          ['USD', 4_000],
        ]),
      },
    ];
    expect(Array.from(finalRegisterBalances(rows) ?? [])).toEqual([
      ['MYR', 3_000],
      ['USD', 4_000],
    ]);
  });
});

describe('renderRegisterHTML', () => {
  test('SSR output includes header, every row, and zero-height spacers', () => {
    const rows = makeRows(5);
    const section = parse(renderRegisterHTML(rows, { account: ACCOUNT }));
    expect(section.hasAttribute('data-register')).toBe(true);
    expect(section.getAttribute('data-density')).toBe('comfortable');
    expect(section.querySelector('[data-register-header]')).not.toBeNull();
    expect(section.querySelectorAll('[data-row]').length).toBe(5);
    expect(section.querySelectorAll('[data-register-spacer]').length).toBe(2);
    // Header balance mirrors the final running balance:
    // 10000 + 10001 - 2500 + 10003 + 10004 = 37508.
    expect(section.querySelector('[data-balance-amount]')?.textContent).toBe(
      '375.08 MYR'
    );
  });

  test('maxSsrRows caps the emitted flat rows without touching the header balance or rowcount', () => {
    const rows = makeRows(5);
    const section = parse(
      renderRegisterHTML(rows, { account: ACCOUNT, maxSsrRows: 2 })
    );
    // Only the first two rows are painted...
    expect(section.querySelectorAll('[data-row]').length).toBe(2);
    const indices = Array.from(section.querySelectorAll('[data-row]')).map(
      (row) => row.getAttribute('data-row-index')
    );
    expect(indices).toEqual(['0', '1']);
    // ...but aria-rowcount still reflects the FULL register (the client
    // re-windows to the rest on hydration), and the header balance is the
    // full running balance, not a sum of the two painted rows.
    expect(section.getAttribute('aria-rowcount')).toBe('5');
    expect(section.querySelector('[data-balance-amount]')?.textContent).toBe(
      '375.08 MYR'
    );
  });

  test('maxSsrRows larger than the row count renders every row', () => {
    const rows = makeRows(3);
    const section = parse(
      renderRegisterHTML(rows, { account: ACCOUNT, maxSsrRows: 1000 })
    );
    expect(section.querySelectorAll('[data-row]').length).toBe(3);
  });
});

describe('renderRegisterHTML amount formats', () => {
  // One row whose posting (1,234.56) and running balance (1,234,567.89)
  // both cross group boundaries, so separators AND grouping are visible.
  function makeFormatRow(): RegisterRowData {
    const entry = makeEntry({
      id: 'fmt-0',
      payee: 'Fmt Payee',
      narration: 'Fmt Narration',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 123_456,
          currency: 'MYR',
        },
        { account: 'Income:Sales', amount: -123_456, currency: 'MYR' },
      ],
    });
    return {
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', 123_456_789]]),
    };
  }

  test('rows and header render dot-comma amounts when the option is set', () => {
    const section = parse(
      renderRegisterHTML([makeFormatRow()], {
        account: ACCOUNT,
        amountFormat: AMOUNT_FORMAT_DOT_COMMA,
      })
    );
    expect(section.querySelector('[data-amount-value]')?.textContent).toBe(
      '1.234,56'
    );
    expect(section.querySelector('[data-balance-value]')?.textContent).toBe(
      '1.234.567,89'
    );
    expect(section.querySelector('[data-balance-amount]')?.textContent).toBe(
      '1.234.567,89 MYR'
    );
  });

  test('Indian grouping threads through rows and balances', () => {
    const section = parse(
      renderRegisterHTML([makeFormatRow()], {
        account: ACCOUNT,
        amountFormat: AMOUNT_FORMAT_INDIAN,
      })
    );
    expect(section.querySelector('[data-balance-value]')?.textContent).toBe(
      '12,34,567.89'
    );
  });

  test('omitting the option and passing the default preset are byte-identical', () => {
    const rows = [makeFormatRow(), ...makeRows(4)];
    expect(renderRegisterHTML(rows, { account: ACCOUNT })).toBe(
      renderRegisterHTML(rows, {
        account: ACCOUNT,
        amountFormat: AMOUNT_FORMAT_COMMA_DOT,
      })
    );
  });
});

describe('register empty state', () => {
  test('zero rows render the empty-state block with the default label', () => {
    const section = parse(renderRegisterHTML([], { account: ACCOUNT }));
    const empty = section.querySelector('[data-register-empty]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe(DEFAULT_REGISTER_EMPTY_LABEL);
    // The sticky header (balance-less: the null case) and both spacers
    // survive around it — the empty state replaces only the rows.
    expect(section.querySelector('[data-register-header]')).not.toBeNull();
    expect(section.querySelector('[data-balance-amount]')).toBeNull();
    expect(section.querySelectorAll('[data-register-spacer]').length).toBe(2);
    expect(section.querySelectorAll('[data-row]').length).toBe(0);
    expect(section.getAttribute('aria-rowcount')).toBe('0');
  });

  test('emptyLabel overrides the guidance text and is escaped', () => {
    const section = parse(
      renderRegisterHTML([], {
        account: ACCOUNT,
        emptyLabel: 'No entries match <this> period & view',
      })
    );
    const empty = section.querySelector('[data-register-empty]');
    expect(empty?.textContent).toBe('No entries match <this> period & view');
    expect(empty?.children.length).toBe(0);
  });

  test('non-empty registers never render the empty state', () => {
    const section = parse(
      renderRegisterHTML(makeRows(3), { account: ACCOUNT })
    );
    expect(section.querySelector('[data-register-empty]')).toBeNull();
  });

  test('renderRegisterEmptyStateHTML defaults and overrides agree with the section path', () => {
    expect(renderRegisterEmptyStateHTML()).toBe(
      `<div data-register-empty>${DEFAULT_REGISTER_EMPTY_LABEL}</div>`
    );
    expect(renderRegisterEmptyStateHTML('Nothing here')).toBe(
      '<div data-register-empty>Nothing here</div>'
    );
  });
});
