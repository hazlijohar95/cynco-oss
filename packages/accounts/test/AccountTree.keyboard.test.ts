import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import { AccountTree } from '../src/render/AccountTree';
import {
  CHART_ACCOUNTS,
  dispatchKey,
  type DomHandle,
  installDom,
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
}

function mountTree(): Mounted {
  const mounted = new AccountTree({ accounts: CHART_ACCOUNTS });
  mounted.render(document.body);
  tree = mounted;
  const container = document.body.querySelector(ACCOUNTS_TAG_NAME);
  const scroller = container?.shadowRoot?.querySelector('[data-scroller]');
  if (!(scroller instanceof HTMLElement)) {
    throw new Error('mountTree: scroller missing');
  }
  stubScrollerGeometry(scroller, { height: 300, scrollHeight: 420 });
  return { tree: mounted, scroller };
}

describe('arrow navigation', () => {
  test('ArrowDown / ArrowUp walk the visible projection', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchKey(scroller, 'ArrowDown');
    expect(mounted.getFocusedPath()).toBe('Assets');
    dispatchKey(scroller, 'ArrowDown');
    dispatchKey(scroller, 'ArrowDown');
    expect(mounted.getFocusedPath()).toBe('Assets:Current:Cash-CIMB');
    dispatchKey(scroller, 'ArrowUp');
    expect(mounted.getFocusedPath()).toBe('Assets:Current');
  });

  test('ArrowRight expands a collapsed group, then dives to the first child', () => {
    const { tree: mounted, scroller } = mountTree();
    mounted.getController().collapseAll();
    mounted.getController().setFocusedPath('Assets');
    dispatchKey(scroller, 'ArrowRight');
    expect(mounted.getController().isExpanded('Assets')).toBe(true);
    expect(mounted.getFocusedPath()).toBe('Assets');
    dispatchKey(scroller, 'ArrowRight');
    expect(mounted.getFocusedPath()).toBe('Assets:Current');
  });

  test('ArrowLeft collapses an expanded group, else jumps to the parent', () => {
    const { tree: mounted, scroller } = mountTree();
    mounted.getController().setFocusedPath('Assets:Current:Cash-CIMB');
    dispatchKey(scroller, 'ArrowLeft'); // Leaf: jump to parent.
    expect(mounted.getFocusedPath()).toBe('Assets:Current');
    dispatchKey(scroller, 'ArrowLeft'); // Expanded group: collapse in place.
    expect(mounted.getController().isExpanded('Assets:Current')).toBe(false);
    expect(mounted.getFocusedPath()).toBe('Assets:Current');
    dispatchKey(scroller, 'ArrowLeft'); // Collapsed group: jump to parent.
    expect(mounted.getFocusedPath()).toBe('Assets');
  });

  test('Home and End jump to the projection edges', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchKey(scroller, 'End');
    expect(mounted.getFocusedPath()).toBe('Liabilities:Current:AP');
    dispatchKey(scroller, 'Home');
    expect(mounted.getFocusedPath()).toBe('Assets');
  });

  test('a full ArrowDown sweep yields the DFS focus sequence', () => {
    const { tree: mounted, scroller } = mountTree();
    mounted.getController().setExpanded('Income', false);
    const sequence: Array<string | null> = [];
    for (let step = 0; step < 12; step += 1) {
      dispatchKey(scroller, 'ArrowDown');
      sequence.push(mounted.getFocusedPath());
    }
    expect(sequence).toEqual([
      'Assets',
      'Assets:Current',
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Assets:Fixed',
      'Assets:Fixed:Equipment',
      'Expenses',
      'Expenses:Rent',
      'Income',
      'Liabilities',
      'Liabilities:Current',
      'Liabilities:Current:AP',
    ]);
  });
});

describe('selection keys', () => {
  test('Enter selects the focused path and fires onSelect', () => {
    const { tree: mounted, scroller } = mountTree();
    const seen: Array<readonly string[]> = [];
    mounted.onSelect((paths) => seen.push(paths));
    mounted.getController().setFocusedPath('Expenses:Rent');
    dispatchKey(scroller, 'Enter');
    expect(mounted.getSelectedPaths()).toEqual(['Expenses:Rent']);
    expect(seen).toEqual([['Expenses:Rent']]);
  });

  test('focused row carries aria-activedescendant on the scroller', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchKey(scroller, 'ArrowDown');
    dispatchKey(scroller, 'ArrowDown');
    const index = mounted
      .getController()
      .getPathIndex(mounted.getFocusedPath() ?? '');
    const active = scroller.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(active?.endsWith(`-row-${index}`)).toBe(true);
  });
});

describe('type-ahead', () => {
  test('single letters focus the next matching row', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchKey(scroller, 'l');
    expect(mounted.getFocusedPath()).toBe('Liabilities');
    dispatchKey(scroller, 'c');
    expect(mounted.getFocusedPath()).toBe('Liabilities:Current');
    dispatchKey(scroller, 'c');
    expect(mounted.getFocusedPath()).toBe('Assets:Current');
  });

  test('modified letters are left to the browser', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchKey(scroller, 'l', { metaKey: true });
    expect(mounted.getFocusedPath()).toBeNull();
  });
});
