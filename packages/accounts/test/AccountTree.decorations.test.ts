// Row decoration lanes: the host-driven `renderDecorations` option — text
// escaping, tone mapping, the 3-per-row cap, dot/text accessibility split,
// coexistence with controller-driven status dots, and the unchanged-markup
// guarantee when the option is absent.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import {
  AccountTree,
  type AccountTreeOptions,
} from '../src/render/AccountTree';
import type {
  AccountDecorationTone,
  AccountRowDecoration,
  AccountRowDecorationContext,
} from '../src/types';
import {
  CHART_ACCOUNTS,
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
  rows: HTMLElement;
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
  if (!(scroller instanceof HTMLElement) || !(rows instanceof HTMLElement)) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, { height: 420, scrollHeight: 420 });
  return { tree: mounted, rows };
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

describe('row decoration lanes', () => {
  test('absent option leaves row markup unchanged', () => {
    const { rows } = mountTree();
    expect(rows.querySelector('[data-decorations]')).toBeNull();
    expect(rows.innerHTML.includes('data-decoration')).toBe(false);
  });

  test('text decorations are escaped — hostile text never becomes markup', () => {
    const hostile = '<img src=x onerror=alert(1)>"&';
    const { tree: mounted, rows } = mountTree({
      renderDecorations: (context) =>
        context.path === 'Expenses:Rent'
          ? [{ kind: 'text', text: hostile }]
          : [],
    });
    const row = rowByPath(mounted, rows, 'Expenses:Rent');
    const text = row.querySelector('[data-decoration-text]');
    expect(text?.textContent).toBe(hostile);
    // The payload survives only as inert text: no element materialized and
    // the serialized markup keeps the angle brackets escaped.
    expect(row.querySelector('img')).toBeNull();
    expect(row.innerHTML.includes('<img')).toBe(false);
    expect(row.innerHTML.includes('&lt;img')).toBe(true);
  });

  test('tones map onto data-tone (the CSS variable hook), defaulting neutral', () => {
    const tones: AccountDecorationTone[] = [
      'neutral',
      'info',
      'success',
      'warn',
      'danger',
    ];
    const { tree: mounted, rows } = mountTree({
      renderDecorations: (context) => {
        if (context.path === 'Expenses:Rent') {
          // Three of the five tones (the cap allows no more per row)...
          return tones
            .slice(0, 3)
            .map((tone) => ({ kind: 'text', text: tone, tone }));
        }
        if (context.path === 'Expenses') {
          return tones
            .slice(3)
            .map((tone) => ({ kind: 'dot', tone }) as AccountRowDecoration)
            .concat([{ kind: 'text', text: 'default' }]);
        }
        return [];
      },
    });
    const leafTones = [
      ...rowByPath(mounted, rows, 'Expenses:Rent').querySelectorAll(
        '[data-decoration-text]'
      ),
    ].map((element) => element.getAttribute('data-tone'));
    expect(leafTones).toEqual(['neutral', 'info', 'success']);
    const groupRow = rowByPath(mounted, rows, 'Expenses');
    const dotTones = [
      ...groupRow.querySelectorAll('[data-decoration-dot]'),
    ].map((element) => element.getAttribute('data-tone'));
    expect(dotTones).toEqual(['warn', 'danger']);
    // Omitted tone falls back to neutral.
    expect(
      groupRow
        .querySelector('[data-decoration-text]')
        ?.getAttribute('data-tone')
    ).toBe('neutral');
  });

  test('junk tones from untyped JS hosts fall back to neutral', () => {
    const { tree: mounted, rows } = mountTree({
      renderDecorations: (context) =>
        context.path === 'Expenses:Rent'
          ? [
              {
                kind: 'text',
                text: 'x',
                tone: '"><script>' as AccountDecorationTone,
              },
            ]
          : [],
    });
    const text = rowByPath(mounted, rows, 'Expenses:Rent').querySelector(
      '[data-decoration-text]'
    );
    expect(text?.getAttribute('data-tone')).toBe('neutral');
    expect(rows.querySelector('script')).toBeNull();
  });

  test('the lane caps at 3 decorations per row', () => {
    const { tree: mounted, rows } = mountTree({
      renderDecorations: () => [
        { kind: 'text', text: '1' },
        { kind: 'dot', tone: 'info' },
        { kind: 'text', text: '3' },
        { kind: 'text', text: '4' },
        { kind: 'dot', tone: 'danger' },
      ],
    });
    const lane = rowByPath(mounted, rows, 'Assets').querySelector(
      '[data-decorations]'
    );
    expect(lane?.children.length).toBe(3);
    expect(lane?.textContent).toBe('13');
  });

  test('dots are aria-hidden; text stays in the accessible tree', () => {
    const { tree: mounted, rows } = mountTree({
      renderDecorations: () => [
        { kind: 'dot', tone: 'warn' },
        { kind: 'text', text: '12 open' },
      ],
    });
    const row = rowByPath(mounted, rows, 'Assets');
    expect(
      row.querySelector('[data-decoration-dot]')?.getAttribute('aria-hidden')
    ).toBe('true');
    // The treeitem's accessible name comes from its text content (no
    // aria-label anywhere on rows), so visible decoration text joins it.
    const text = row.querySelector('[data-decoration-text]');
    expect(text?.hasAttribute('aria-hidden')).toBe(false);
    expect(row.textContent?.includes('12 open')).toBe(true);
  });

  test('the host lane coexists with controller-driven status dots', () => {
    const { tree: mounted, rows } = mountTree({
      renderDecorations: (context) =>
        context.path === 'Expenses:Rent'
          ? [{ kind: 'text', text: 'audit', tone: 'info' }]
          : [],
    });
    mounted.setAccountStatus([
      { path: 'Expenses:Rent', status: 'flagged', count: 2 },
    ]);
    const row = rowByPath(mounted, rows, 'Expenses:Rent');
    // Both lanes render, distinct elements: status (controller state,
    // rolled up onto ancestors) first, then the host decorations.
    const statusDot = row.querySelector('[data-status-dot]');
    const lane = row.querySelector('[data-decorations]');
    expect(statusDot).not.toBeNull();
    expect(lane).not.toBeNull();
    expect(
      statusDot!.compareDocumentPosition(lane!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('context carries visibleChildCount for expanded groups only', () => {
    const seen = new Map<string, AccountRowDecorationContext>();
    const { tree: mounted } = mountTree({
      renderDecorations(context) {
        seen.set(context.path, { ...context });
        return [];
      },
    });
    expect(seen.get('Assets:Current')?.visibleChildCount).toBe(2);
    expect(seen.get('Expenses:Rent')?.visibleChildCount).toBe(0);
    expect(seen.get('Assets:Current')?.isGroup).toBe(true);
    expect(seen.get('Assets:Current')?.depth).toBe(1);

    seen.clear();
    mounted.setExpanded('Assets:Current', false);
    expect(seen.get('Assets:Current')?.visibleChildCount).toBe(0);
  });
});
