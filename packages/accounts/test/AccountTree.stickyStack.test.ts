// Sticky ancestor stack (`stickyAncestors: 'stack'`): stacked aria-hidden
// mirrors of the top visible row's off-screen visible-ancestor chain, click
// forwarding to the real rows, the STICKY_ANCESTOR_STACK_MAX cap, and the
// flatten / hide-non-matches interplay. The default 'nearest' behavior is
// asserted unchanged (and further covered by the untouched virtualization
// suite).

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
import {
  dispatchScroll,
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

// Deep chart: Top > Mid > Inner holds 100 leaves (rows 3..102), then a flat
// sibling subtree Zoo with 40 leaves. 30px rows, fully expanded.
const DEEP_ACCOUNTS: string[] = [];
for (let leaf = 0; leaf < 100; leaf += 1) {
  DEEP_ACCOUNTS.push(`Top:Mid:Inner:Leaf${String(leaf).padStart(2, '0')}`);
}
for (let leaf = 0; leaf < 40; leaf += 1) {
  DEEP_ACCOUNTS.push(`Zoo:Leaf${String(leaf).padStart(2, '0')}`);
}

interface Mounted {
  tree: AccountTree;
  scroller: HTMLElement;
  sticky: HTMLElement;
  spacerBefore: HTMLElement;
}

function mountTree(
  options: Partial<AccountTreeOptions> = {},
  accounts: readonly string[] = DEEP_ACCOUNTS
): Mounted {
  const mounted = new AccountTree({ accounts, overscanRows: 10, ...options });
  mounted.render(document.body);
  tree = mounted;
  const shadowRoot = document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const sticky = shadowRoot?.querySelector('[data-sticky-header]');
  const spacerBefore = shadowRoot?.querySelector('[data-spacer="before"]');
  if (
    !(scroller instanceof HTMLElement) ||
    !(sticky instanceof HTMLElement) ||
    !(spacerBefore instanceof HTMLElement)
  ) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, {
    height: 300,
    scrollHeight: mounted.getController().getTotalHeight(),
  });
  dispatchScroll(scroller);
  return { tree: mounted, scroller, sticky, spacerBefore };
}

function stickyNames(sticky: HTMLElement): string[] {
  return [...sticky.querySelectorAll('[data-row] [data-name]')].map(
    (name) => name.textContent ?? ''
  );
}

describe('sticky ancestor stack', () => {
  test("default 'nearest' keeps the single v1 mirror and inert header", () => {
    const { scroller, sticky } = mountTree();
    scroller.scrollTop = 10 * 30; // Top row: a leaf inside Top:Mid:Inner.
    dispatchScroll(scroller);
    expect(sticky.hidden).toBe(false);
    expect(stickyNames(sticky)).toEqual(['Inner']);
    expect(sticky.hasAttribute('data-sticky-stack')).toBe(false);
  });

  test('stacks every off-screen visible ancestor, root first', () => {
    const { scroller, sticky } = mountTree({ stickyAncestors: 'stack' });
    scroller.scrollTop = 10 * 30;
    dispatchScroll(scroller);

    expect(sticky.hidden).toBe(false);
    expect(sticky.getAttribute('data-sticky-stack')).toBe('true');
    expect(stickyNames(sticky)).toEqual(['Top', 'Mid', 'Inner']);
    // Mirrors are decorative: aria-hidden, no treeitem semantics, and they
    // carry data-path for click forwarding instead of a row index.
    for (const row of sticky.querySelectorAll('[data-row]')) {
      expect(row.getAttribute('aria-hidden')).toBe('true');
      expect(row.hasAttribute('role')).toBe(false);
      expect(row.getAttribute('data-path')).toBeTruthy();
    }

    // Crossing into the flat sibling subtree shrinks the stack to its
    // single ancestor.
    const zooIndex = tree!.getController().getPathIndex('Zoo:Leaf05');
    scroller.scrollTop = zooIndex * 30;
    dispatchScroll(scroller);
    expect(stickyNames(sticky)).toEqual(['Zoo']);

    // Back at the very top there is nothing off-screen to mirror.
    scroller.scrollTop = 0;
    dispatchScroll(scroller);
    expect(sticky.hidden).toBe(true);
  });

  test('compensates the before-spacer for the stack flow height', () => {
    const {
      tree: mounted,
      scroller,
      spacerBefore,
    } = mountTree({
      stickyAncestors: 'stack',
    });
    scroller.scrollTop = 50 * 30;
    dispatchScroll(scroller);

    const range = mounted.getRenderedRange();
    expect(range?.start).toBe(40); // topIndex 50 − 10 overscan.
    // Three mirror rows occupy 90px of flow space at the top of the
    // content, so the spacer shrinks by the same pixels to keep row i at
    // exactly i × rowHeight.
    expect(spacerBefore.style.height).toBe(`${40 * 30 - 3 * 30}px`);
  });

  test('caps the stack at 4 mirrors, nearest ancestors winning', () => {
    const deep: string[] = [];
    for (let leaf = 0; leaf < 60; leaf += 1) {
      deep.push(`L1:L2:L3:L4:L5:L6:Leaf${String(leaf).padStart(2, '0')}`);
    }
    const { scroller, sticky } = mountTree({ stickyAncestors: 'stack' }, deep);
    scroller.scrollTop = 20 * 30; // Top row: a leaf at depth 6.
    dispatchScroll(scroller);

    // Six ancestors exist; only the four NEAREST render — the deep ones
    // identify the rows under the cursor, the root is the most guessable.
    expect(stickyNames(sticky)).toEqual(['L3', 'L4', 'L5', 'L6']);
  });

  test('clicking a mirror scrolls to and focuses the real ancestor row', () => {
    const {
      tree: mounted,
      scroller,
      sticky,
    } = mountTree({
      stickyAncestors: 'stack',
    });
    scroller.scrollTop = 50 * 30;
    dispatchScroll(scroller);

    const midMirror = [...sticky.querySelectorAll('[data-row]')].find(
      (row) => row.getAttribute('data-path') === 'Top:Mid'
    );
    if (!(midMirror instanceof HTMLElement)) {
      throw new Error('Mid mirror missing');
    }
    midMirror.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );

    expect(mounted.getFocusedPath()).toBe('Top:Mid');
    // Mid sits at index 1 with one visible ancestor (Top): the scroll
    // lands it just below a one-row stack, i.e. scrollTop 0.
    expect(scroller.scrollTop).toBe(0);
  });

  test('under flattening the stack mirrors flattened chain rows only', () => {
    const {
      tree: mounted,
      scroller,
      sticky,
    } = mountTree({
      stickyAncestors: 'stack',
      flattenEmptyGroups: true,
    });
    scroller.scrollTop = 10 * 30;
    dispatchScroll(scroller);

    // Top > Mid > Inner flattens to one chain row keyed by Inner; the
    // hidden mid-chain groups must never appear as mirrors.
    const names = stickyNames(sticky);
    expect(names.length).toBe(1);
    expect(names[0]?.replaceAll(/\s+/g, ' ')).toContain('Top');
    const mirror = sticky.querySelector('[data-row]');
    expect(mirror?.getAttribute('data-path')).toBe('Top:Mid:Inner');
    expect(mounted.getController().getPathIndex('Top:Mid')).toBe(-1);
  });

  test('under hide-non-matches the stack uses the filtered projection', () => {
    const {
      tree: mounted,
      scroller,
      sticky,
    } = mountTree({
      stickyAncestors: 'stack',
    });
    // 'inner' matches the Inner group and (via the shared segment) all its
    // leaves; Zoo's subtree is filtered out of the projection entirely.
    mounted.getController().beginSearch('inner', { mode: 'hide-non-matches' });
    scroller.scrollTop = 50 * 30;
    dispatchScroll(scroller);

    expect(stickyNames(sticky)).toEqual(['Top', 'Mid', 'Inner']);
    expect(mounted.getController().getPathIndex('Zoo')).toBe(-1);

    mounted.getController().endSearch();
    dispatchScroll(scroller);
    expect(stickyNames(sticky)).toEqual(['Top', 'Mid', 'Inner']);
  });
});
