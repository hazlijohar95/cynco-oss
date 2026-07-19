// Account icon system: the `icons.resolver` option, the built-in closed
// icon set, the default heuristics resolver, and the hot-path contract
// (resolver runs once per rendered row per window commit — never per
// attribute patch).

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import { ACCOUNT_ICON_PATHS } from '../src/render/accountIcons';
import {
  AccountTree,
  type AccountTreeOptions,
} from '../src/render/AccountTree';
import { createDefaultAccountIconResolver } from '../src/render/createDefaultAccountIconResolver';
import type { AccountIconContext, AccountIconName } from '../src/types';
import {
  CHART_ACCOUNTS,
  dispatchScroll,
  type DomHandle,
  installDom,
  makeChartEntries,
  stubScrollerGeometry,
} from './domHarness';

let dom: DomHandle;
let tree: AccountTree | undefined;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

afterEach(() => {
  tree?.cleanUp();
  tree = undefined;
});

interface Mounted {
  tree: AccountTree;
  scroller: HTMLElement;
  rows: HTMLElement;
  sticky: HTMLElement;
}

function mountTree(options: AccountTreeOptions = {}): Mounted {
  const mounted = new AccountTree({
    accounts: CHART_ACCOUNTS,
    entries: makeChartEntries(),
    ...options,
  });
  mounted.render(document.body);
  tree = mounted;
  const shadowRoot = document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rows = shadowRoot?.querySelector('[data-rows]');
  const sticky = shadowRoot?.querySelector('[data-sticky-header]');
  if (
    !(scroller instanceof HTMLElement) ||
    !(rows instanceof HTMLElement) ||
    !(sticky instanceof HTMLElement)
  ) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, {
    height: 420,
    scrollHeight: mounted.getController().getTotalHeight(),
  });
  return { tree: mounted, scroller, rows, sticky };
}

function rowByPath(
  mounted: AccountTree,
  rows: HTMLElement,
  path: string
): HTMLElement {
  const index = mounted.getController().getPathIndex(path);
  const row = rows.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row for ${path} not rendered`);
  }
  return row;
}

describe('icon rendering', () => {
  test('absent option renders no icon markup at all', () => {
    const { rows } = mountTree();
    expect(rows.querySelector('[data-icon]')).toBeNull();
    expect(rows.innerHTML.includes('data-icon')).toBe(false);
  });

  test('resolver receives path, name, isGroup, and depth per row', () => {
    const seen = new Map<string, AccountIconContext>();
    mountTree({
      icons: {
        resolver(context) {
          seen.set(context.path, { ...context });
          return null;
        },
      },
    });
    expect(seen.get('Assets')).toEqual({
      path: 'Assets',
      name: 'Assets',
      isGroup: true,
      depth: 0,
    });
    expect(seen.get('Assets:Current:Cash-Maybank')).toEqual({
      path: 'Assets:Current:Cash-Maybank',
      name: 'Cash-Maybank',
      isGroup: false,
      depth: 2,
    });
  });

  test('built-in names render a decorative svg from the closed set', () => {
    const { tree: mounted, rows } = mountTree({
      icons: { resolver: () => 'bank' },
    });
    const icon = rowByPath(
      mounted,
      rows,
      'Assets:Current:Cash-Maybank'
    ).querySelector('[data-icon]');
    expect(icon instanceof HTMLElement).toBe(true);
    expect((icon as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((icon as HTMLElement).getAttribute('data-icon-name')).toBe('bank');
    const svg = (icon as HTMLElement).querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
      ACCOUNT_ICON_PATHS.bank
    );
  });

  test('null (and out-of-union junk from JS hosts) renders no icon', () => {
    const { tree: mounted, rows } = mountTree({
      icons: {
        resolver: (context) =>
          context.path === 'Assets'
            ? // Untyped hosts can return arbitrary strings; the closed-union
              // runtime check must resolve them to "no icon", never markup.
              ('"><img src=x onerror=alert(1)>' as AccountIconName)
            : null,
      },
    });
    expect(rows.querySelector('[data-icon]')).toBeNull();
    expect(
      rowByPath(mounted, rows, 'Assets').innerHTML.includes('onerror')
    ).toBe(false);
  });

  test('every built-in icon name has non-empty path data', () => {
    const names: AccountIconName[] = [
      'bank',
      'cash',
      'wallet',
      'receivable',
      'payable',
      'income',
      'expense',
      'equity',
      'folder',
      'chart',
    ];
    for (const name of names) {
      expect(ACCOUNT_ICON_PATHS[name].length).toBeGreaterThan(0);
      // Path data must be inert: no markup characters that could escape the
      // d="..." attribute if the record were ever edited carelessly.
      expect(ACCOUNT_ICON_PATHS[name]).not.toMatch(/[<>"&]/);
    }
  });

  test('default resolver maps every documented top-level heuristic', () => {
    const resolve = createDefaultAccountIconResolver();
    const leaf = (path: string): AccountIconContext => ({
      path,
      name: path.slice(path.lastIndexOf(':') + 1),
      isGroup: false,
      depth: path.split(':').length - 1,
    });
    // Groups → folder, any top-level segment.
    expect(
      resolve({ path: 'Assets', name: 'Assets', isGroup: true, depth: 0 })
    ).toBe('folder');
    expect(
      resolve({
        path: 'Income:Sales',
        name: 'Sales',
        isGroup: true,
        depth: 1,
      })
    ).toBe('folder');
    // Assets leaves: bank/cash-ish names win, wallet otherwise.
    expect(resolve(leaf('Assets:Current:Cash-Maybank'))).toBe('cash');
    expect(resolve(leaf('Assets:Current:Bank-CIMB'))).toBe('bank');
    expect(resolve(leaf('Assets:Current:Trade-Receivables'))).toBe(
      'receivable'
    );
    expect(resolve(leaf('Assets:Fixed:Equipment'))).toBe('wallet');
    // Remaining top-level segments.
    expect(resolve(leaf('Liabilities:Current:AP'))).toBe('payable');
    expect(resolve(leaf('Income:Sales:Consulting'))).toBe('income');
    expect(resolve(leaf('Expenses:Rent'))).toBe('expense');
    expect(resolve(leaf('Equity:Retained'))).toBe('equity');
    // Unknown top-level segment: no icon.
    expect(resolve(leaf('Misc:Other'))).toBeNull();
  });

  test('sticky mirror rows keep the icon', () => {
    const { scroller, sticky } = mountTree({
      icons: { resolver: createDefaultAccountIconResolver() },
    });
    // Scroll a couple of rows down so 'Assets' scrolls off and mirrors.
    scroller.scrollTop = 3 * 30;
    dispatchScroll(scroller);
    expect(sticky.hidden).toBe(false);
    const icon = sticky.querySelector('[data-row] [data-icon]');
    expect(icon instanceof HTMLElement).toBe(true);
    expect((icon as HTMLElement).getAttribute('data-icon-name')).toBe('folder');
  });

  test('the renaming row keeps its icon next to the editor', () => {
    const { tree: mounted, rows } = mountTree({
      icons: { resolver: createDefaultAccountIconResolver() },
    });
    mounted.beginRename('Expenses:Rent');
    const row = rowByPath(mounted, rows, 'Expenses:Rent');
    expect(row.querySelector('[data-rename-input]')).not.toBeNull();
    expect(
      row.querySelector('[data-icon]')?.getAttribute('data-icon-name')
    ).toBe('expense');
  });

  test('resolver runs once per rendered row per commit, never per patch', () => {
    let calls = 0;
    const { tree: mounted } = mountTree({
      icons: {
        resolver() {
          calls += 1;
          return null;
        },
      },
    });
    const range = mounted.getRenderedRange();
    if (range == null) {
      throw new Error('no rendered range');
    }
    const windowSize = range.end - range.start;
    expect(windowSize).toBeGreaterThan(0);
    // Mounting commits exactly one window: one resolver call per row.
    expect(calls).toBe(windowSize);

    // Selection/focus changes are attribute patches — zero resolver calls.
    mounted.getController().selectPath('Assets:Current:Cash-CIMB');
    mounted.getController().selectPath('Expenses:Rent');
    expect(calls).toBe(windowSize);

    // An expansion change forces a fresh window commit: one more call per
    // (re-)rendered row.
    mounted.setExpanded('Assets:Current', false);
    const nextRange = mounted.getRenderedRange();
    if (nextRange == null) {
      throw new Error('no rendered range after collapse');
    }
    expect(calls).toBe(windowSize + (nextRange.end - nextRange.start));
  });
});
