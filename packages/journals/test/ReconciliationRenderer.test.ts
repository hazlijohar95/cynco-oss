import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { MINUS_SIGN } from '../src/constants';
import {
  computeReconciliationTotals,
  type ReconciliationRenderState,
  renderReconciliationHTML,
} from '../src/renderers/ReconciliationRenderer';
import { proposeMatches } from '../src/utils/proposeMatches';
import {
  type DomHandle,
  installDom,
  makeBookPosting,
  makeStatementLine,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const ACCOUNT = 'Assets:Current:Cash-Maybank';

// Fixture: one exact match, one suggested (+2d), one statement-only line,
// one book-only posting.
function makeState(): ReconciliationRenderState {
  const lines = [
    makeStatementLine({
      id: 's1',
      date: '2026-07-02',
      amount: 15_000,
      description: 'ACME TRANSFER',
    }),
    makeStatementLine({
      id: 's2',
      date: '2026-07-05',
      amount: -4_200,
      description: 'TNB BILL',
    }),
    makeStatementLine({
      id: 's3',
      date: '2026-07-09',
      amount: 999,
      description: 'BANK FEE',
    }),
  ];
  const postings = [
    makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
    makeBookPosting({ entryId: 'e2', date: '2026-07-07', amount: -4_200 }),
    makeBookPosting({ entryId: 'e3', date: '2026-07-11', amount: 88_800 }),
  ];
  return {
    account: ACCOUNT,
    periodLabel: 'Jul 2026',
    lines,
    postings,
    matches: proposeMatches(lines, postings),
  };
}

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error('parse: renderer produced no element');
  }
  return first;
}

// Compact projection: row type plus which side(s) have content.
function projectRows(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('[data-recon-row]')).map((row) => {
    const type = row.getAttribute('data-row-type');
    const kind = row.getAttribute('data-match-kind');
    const status = row.getAttribute('data-match-status');
    const suffix = kind != null ? ` ${kind}/${status}` : '';
    return `${type}${suffix}`;
  });
}

describe('renderReconciliationHTML', () => {
  test('rows project matched pairs and both unmatched kinds in date order', () => {
    const root = parse(renderReconciliationHTML(makeState()));
    expect(projectRows(root)).toEqual([
      'pair exact/proposed', // s1 + e1, 07-02
      'pair suggested/proposed', // s2 + e2, 07-05
      'statement-only', // s3, 07-09
      'book-only', // e3, 07-11
    ]);
  });

  test('suggested pairs show the signed date-delta hint', () => {
    const root = parse(renderReconciliationHTML(makeState()));
    const suggested = root.querySelector('[data-match-kind="suggested"]');
    expect(suggested?.querySelector('[data-date-delta]')?.textContent).toBe(
      '+2d'
    );
    const exact = root.querySelector('[data-match-kind="exact"]');
    expect(exact?.querySelector('[data-date-delta]')).toBeNull();
  });

  test('proposed pairs expose accept/reject; unmatched rows expose their affordances', () => {
    const root = parse(renderReconciliationHTML(makeState()));
    const pair = root.querySelector('[data-match-kind="exact"]');
    expect(pair?.querySelector('[data-recon-action="accept"]')).not.toBeNull();
    expect(pair?.querySelector('[data-recon-action="reject"]')).not.toBeNull();

    const statementOnly = root.querySelector(
      '[data-row-type="statement-only"]'
    );
    const createButton = statementOnly?.querySelector(
      '[data-recon-action="create-entry"]'
    );
    expect(createButton?.getAttribute('data-line-id')).toBe('s3');
    // The empty book cell is pinstriped.
    expect(
      statementOnly?.querySelector('[data-recon-cell="book"][data-recon-empty]')
    ).not.toBeNull();

    const bookOnly = root.querySelector('[data-row-type="book-only"]');
    expect(
      bookOnly?.querySelector('[data-recon-cell="statement"][data-recon-empty]')
    ).not.toBeNull();
    expect(
      bookOnly?.querySelector('[data-recon-outstanding]')?.textContent
    ).toBe('outstanding');
  });

  test('accepted pairs swap the gutter to undo and gain the reconciled dot', () => {
    const state = makeState();
    const accepted = state.matches.map((match) =>
      match.statementLineId === 's1'
        ? { ...match, status: 'accepted' as const }
        : match
    );
    const root = parse(
      renderReconciliationHTML({ ...state, matches: accepted })
    );
    const row = root.querySelector('[data-match-status="accepted"]');
    expect(row?.querySelector('[data-recon-action="undo"]')).not.toBeNull();
    expect(row?.querySelector('[data-recon-action="accept"]')).toBeNull();
    expect(
      row?.querySelector('[data-flag-dot][data-flag="cleared"]')
    ).not.toBeNull();
  });

  test('header figures: statement, cleared, and nonzero difference in danger state', () => {
    const root = parse(renderReconciliationHTML(makeState()));
    // Statement total: 15000 - 4200 + 999 = 11799. Nothing accepted yet.
    expect(
      root.querySelector('[data-recon-figure="statement"] [data-figure-value]')
        ?.textContent
    ).toBe('117.99 MYR');
    expect(
      root.querySelector('[data-recon-figure="cleared"] [data-figure-value]')
        ?.textContent
    ).toBe('0.00');
    const difference = root.querySelector('[data-recon-figure="difference"]');
    expect(difference?.getAttribute('data-difference')).toBe('nonzero');
    expect(difference?.querySelector('[data-figure-value]')?.textContent).toBe(
      '117.99 MYR'
    );
    expect(difference?.querySelector('[data-recon-dot]')).toBeNull();
  });

  test('zero difference flips to the reconciled state with a dot', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
    ];
    const matches = proposeMatches(lines, postings).map((match) => ({
      ...match,
      status: 'accepted' as const,
    }));
    const root = parse(
      renderReconciliationHTML({ account: ACCOUNT, lines, postings, matches })
    );
    const difference = root.querySelector('[data-recon-figure="difference"]');
    expect(difference?.getAttribute('data-difference')).toBe('zero');
    expect(difference?.querySelector('[data-recon-dot]')).not.toBeNull();
    expect(difference?.querySelector('[data-figure-value]')?.textContent).toBe(
      '0.00 MYR'
    );
  });

  test('computeReconciliationTotals keeps currencies separate with integer math', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: -10_050 }),
      makeStatementLine({
        id: 's2',
        date: '2026-07-03',
        amount: 7_777,
        currency: 'USD',
      }),
    ];
    const { statement, cleared, difference } = computeReconciliationTotals({
      account: ACCOUNT,
      lines,
      postings: [],
      matches: [],
    });
    expect(statement.get('MYR')).toBe(-10_050);
    expect(statement.get('USD')).toBe(7_777);
    expect(cleared.size).toBe(0);
    expect(difference.get('MYR')).toBe(-10_050);
    expect(difference.get('USD')).toBe(7_777);
  });

  test('escapes statement descriptions', () => {
    const lines = [
      makeStatementLine({
        id: 's1',
        date: '2026-07-02',
        amount: 100,
        description: '<img src=x onerror=alert(1)>',
      }),
    ];
    const root = parse(
      renderReconciliationHTML({
        account: ACCOUNT,
        lines,
        postings: [],
        matches: [],
      })
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-description]')?.textContent).toBe(
      '<img src=x onerror=alert(1)>'
    );
  });

  test('credit statement lines render the proper minus semantics', () => {
    const root = parse(renderReconciliationHTML(makeState()));
    const credit = root.querySelector(
      '[data-recon-cell="statement"][data-amount="credit"]'
    );
    expect(credit?.querySelector('[data-amount-value]')?.textContent).toBe(
      '42.00'
    );
    expect(
      credit
        ?.querySelector('[data-amount-sign]')
        ?.getAttribute('data-amount-sign')
    ).toBe('credit');
    expect(MINUS_SIGN).toBe('\u2212');
  });

  // Single full-fidelity canary: any intentional markup change must update
  // this snapshot, everything else stays behavioral projections.
  test('full HTML snapshot canary', () => {
    expect(renderReconciliationHTML(makeState())).toMatchSnapshot();
  });
});
