import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  MINUS_SIGN,
} from '../src/constants';
import { AccountTreeController } from '../src/model/AccountTreeController';
import {
  renderAccountRowHTML,
  renderAccountRowsHTML,
  renderStickyRowHTML,
} from '../src/render/AccountTreeRenderer';
import {
  CHART_ACCOUNTS,
  type DomHandle,
  installDom,
  makeChartEntries,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const RENDER_OPTIONS = { currency: 'MYR', idPrefix: 'acct-test' };

function makeController(): AccountTreeController {
  return new AccountTreeController({
    entries: makeChartEntries(),
    accounts: CHART_ACCOUNTS,
  });
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

// Compact row projection: '▾ Assets depth=0 bal=700.00' — chevron glyph from
// expansion state, then name, depth, and the formatted balance when present.
function projectRow(element: HTMLElement): string {
  const kind = element.getAttribute('data-kind');
  const chevron =
    kind === 'leaf'
      ? '\u00b7'
      : element.getAttribute('data-expanded') === 'true'
        ? '\u25be'
        : '\u25b8';
  const name = element.querySelector('[data-name]')?.textContent ?? '';
  const depth = element.getAttribute('data-depth');
  const balance = element.querySelector('[data-balance]')?.textContent;
  const status = element
    .querySelector('[data-status-dot]')
    ?.getAttribute('data-status');
  let projection = `${chevron} ${name} depth=${depth}`;
  if (balance != null) {
    projection += ` bal=${balance}`;
  }
  if (status != null) {
    projection += ` status=${status}`;
  }
  return projection;
}

function projectWindow(
  controller: AccountTreeController,
  start: number,
  end: number
): string[] {
  const html = renderAccountRowsHTML(
    controller.getRows(start, end),
    { start, end },
    RENDER_OPTIONS
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return Array.from(host.querySelectorAll('[data-row]')).map((row) =>
    projectRow(row as HTMLElement)
  );
}

describe('renderAccountRowsHTML', () => {
  test('projects a window with balances rolled into the primary currency', () => {
    const controller = makeController();
    expect(projectWindow(controller, 0, 8)).toEqual([
      '\u25be Assets depth=0 bal=700.00',
      '\u25be Current depth=1 bal=700.00',
      '\u00b7 Cash-CIMB depth=2', // USD only: no MYR balance span at all.
      '\u00b7 Cash-Maybank depth=2 bal=700.00',
      '\u25be Fixed depth=1',
      '\u00b7 Equipment depth=2',
      '\u25be Expenses depth=0 bal=800.00',
      '\u00b7 Rent depth=1 bal=800.00',
    ]);
  });

  test('collapsed groups render the collapsed chevron and window indices stay absolute', () => {
    const controller = makeController();
    controller.collapseAll();
    const html = renderAccountRowsHTML(
      controller.getRows(1, 3),
      { start: 1, end: 3 },
      RENDER_OPTIONS
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const rows = Array.from(host.querySelectorAll('[data-row]'));
    expect(rows.map((row) => row.getAttribute('data-row-index'))).toEqual([
      '1',
      '2',
    ]);
    expect(rows.map((row) => projectRow(row as HTMLElement))).toEqual([
      '\u25b8 Expenses depth=0 bal=800.00',
      `\u25b8 Income depth=0 bal=${MINUS_SIGN}1,500.00`,
    ]);
  });
});

describe('renderAccountRowHTML', () => {
  test('carries the full aria treeitem contract from store-provided values', () => {
    const controller = makeController();
    const [assets] = controller.getRows(0, 1);
    const row = parse(renderAccountRowHTML(assets, 0, RENDER_OPTIONS));
    expect(row.getAttribute('role')).toBe('treeitem');
    expect(row.getAttribute('aria-level')).toBe('1');
    expect(row.getAttribute('aria-posinset')).toBe('1');
    expect(row.getAttribute('aria-setsize')).toBe('4');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.getAttribute('aria-selected')).toBe('false');
    expect(row.getAttribute('id')).toBe('acct-test-row-0');
    expect(row.getAttribute('tabindex')).toBe('-1');
  });

  test('leaves carry posinset/setsize but never aria-expanded', () => {
    const controller = makeController();
    const [cimb] = controller.getRows(2, 3);
    const row = parse(renderAccountRowHTML(cimb, 2, RENDER_OPTIONS));
    expect(row.getAttribute('data-kind')).toBe('leaf');
    expect(row.getAttribute('aria-posinset')).toBe('1');
    expect(row.getAttribute('aria-setsize')).toBe('2');
    expect(row.hasAttribute('aria-expanded')).toBe(false);
    // One indent guide per ancestor level.
    expect(row.querySelectorAll('[data-indent-guide]').length).toBe(2);
  });

  test('negative balances carry data-negative and the proper minus sign', () => {
    const controller = makeController();
    const index = controller.getPathIndex('Income');
    const [income] = controller.getRows(index, index + 1);
    const row = parse(renderAccountRowHTML(income, index, RENDER_OPTIONS));
    const balance = row.querySelector('[data-balance]');
    expect(balance?.getAttribute('data-negative')).toBe('true');
    expect(balance?.textContent).toBe(`${MINUS_SIGN}1,500.00`);
  });

  test('amountFormat reshapes the balance column; the default stays byte-identical', () => {
    const controller = makeController();
    const index = controller.getPathIndex('Income');
    const [income] = controller.getRows(index, index + 1);
    const dotComma = parse(
      renderAccountRowHTML(income, index, {
        ...RENDER_OPTIONS,
        amountFormat: AMOUNT_FORMAT_DOT_COMMA,
      })
    );
    // Same figure as above (−1,500.00), continental separators, sign kept.
    expect(dotComma.querySelector('[data-balance]')?.textContent).toBe(
      `${MINUS_SIGN}1.500,00`
    );
    // Passing the default preset changes nothing, byte for byte.
    expect(
      renderAccountRowHTML(income, index, {
        ...RENDER_OPTIONS,
        amountFormat: AMOUNT_FORMAT_COMMA_DOT,
      })
    ).toBe(renderAccountRowHTML(income, index, RENDER_OPTIONS));
  });

  test('status dot and count render from the decorated row', () => {
    const controller = makeController();
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
    ]);
    const index = controller.getPathIndex('Assets:Current:Cash-Maybank');
    const [row] = controller.getRows(index, index + 1);
    const element = parse(renderAccountRowHTML(row, index, RENDER_OPTIONS));
    expect(element.getAttribute('data-status')).toBe('unreconciled');
    expect(
      element.querySelector('[data-status-dot]')?.getAttribute('data-status')
    ).toBe('unreconciled');
    expect(element.querySelector('[data-status-count]')?.textContent).toBe('3');
  });

  test('selection, focus, and search-match decorations become data attributes', () => {
    const controller = makeController();
    controller.selectPath('Assets:Current:Cash-Maybank');
    controller.beginSearch('maybank');
    const index = controller.getPathIndex('Assets:Current:Cash-Maybank');
    const [row] = controller.getRows(index, index + 1);
    const element = parse(renderAccountRowHTML(row, index, RENDER_OPTIONS));
    expect(element.getAttribute('data-selected')).toBe('true');
    expect(element.getAttribute('aria-selected')).toBe('true');
    expect(element.getAttribute('data-focused')).toBe('true');
    expect(element.getAttribute('data-search-match')).toBe('true');
    expect(element.getAttribute('tabindex')).toBe('0');
  });

  test('names are HTML-escaped', () => {
    const controller = new AccountTreeController({
      accounts: ['Expenses:R&D <lab>'],
    });
    const [, row] = controller.getRows(0, 2);
    const html = renderAccountRowHTML(row, 1, RENDER_OPTIONS);
    expect(html).toContain('R&amp;D &lt;lab&gt;');
    expect(html).not.toContain('<lab>');
  });
});

describe('renderStickyRowHTML', () => {
  test('mirror rows are aria-hidden and carry no treeitem semantics', () => {
    const controller = makeController();
    const [assets] = controller.getRows(0, 1);
    const sticky = parse(renderStickyRowHTML(assets, RENDER_OPTIONS));
    expect(sticky.getAttribute('data-sticky-row')).toBe('true');
    expect(sticky.getAttribute('aria-hidden')).toBe('true');
    expect(sticky.hasAttribute('role')).toBe(false);
    expect(sticky.hasAttribute('id')).toBe(false);
    expect(sticky.querySelector('[data-name]')?.textContent).toBe('Assets');
  });
});

describe('snapshot canary', () => {
  test('full small-tree window HTML', () => {
    const controller = makeController();
    controller.setAccountStatus([
      { path: 'Liabilities:Current:AP', status: 'flagged', count: 2 },
    ]);
    controller.selectPath('Expenses:Rent');
    const html = renderAccountRowsHTML(
      controller.getRows(0, controller.getVisibleCount()),
      { start: 0, end: controller.getVisibleCount() },
      RENDER_OPTIONS
    );
    expect(html).toMatchSnapshot();
  });
});
