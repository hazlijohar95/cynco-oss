// Measured middle truncation (`nameTruncation: 'middle'`). jsdom performs
// no layout, so name-element geometry is stubbed at the Element prototype
// (the domHarness geometry-stub pattern, lifted to survive innerHTML window
// rewrites): scrollWidth is a deterministic 10px per character of the
// element's CURRENT text, clientWidth a mutable per-test budget.

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
import { type DomHandle, installDom, stubScrollerGeometry } from './domHarness';

let dom: DomHandle;
let tree: AccountTree | undefined;

const PX_PER_CHAR = 10;
/** Mutable clientWidth for [data-name] elements; tests shrink/grow it. */
let nameClientWidth = 100;

let originalScrollWidth: PropertyDescriptor | undefined;
let originalClientWidth: PropertyDescriptor | undefined;
let originalGlobalResizeObserver: unknown;
let originalWindowResizeObserver: unknown;

/** Captures ResizeObserver callbacks so tests can fire resizes manually. */
class CapturingResizeObserver {
  static callbacks: (() => void)[] = [];
  constructor(callback: () => void) {
    CapturingResizeObserver.callbacks.push(callback);
  }
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

beforeAll(() => {
  dom = installDom();
  const elementPrototype = dom.window.Element.prototype;
  originalScrollWidth = Object.getOwnPropertyDescriptor(
    elementPrototype,
    'scrollWidth'
  );
  originalClientWidth = Object.getOwnPropertyDescriptor(
    elementPrototype,
    'clientWidth'
  );
  Object.defineProperty(elementPrototype, 'scrollWidth', {
    configurable: true,
    get(this: Element) {
      return (this.textContent ?? '').length * PX_PER_CHAR;
    },
  });
  Object.defineProperty(elementPrototype, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute('data-name') ? nameClientWidth : 1000;
    },
  });
  originalGlobalResizeObserver = (globalThis as { ResizeObserver?: unknown })
    .ResizeObserver;
  originalWindowResizeObserver = (
    dom.window as unknown as { ResizeObserver?: unknown }
  ).ResizeObserver;
  Object.assign(globalThis, { ResizeObserver: CapturingResizeObserver });
  Object.assign(dom.window, { ResizeObserver: CapturingResizeObserver });
});

afterAll(() => {
  const elementPrototype = dom.window.Element.prototype;
  if (originalScrollWidth != null) {
    Object.defineProperty(elementPrototype, 'scrollWidth', originalScrollWidth);
  }
  if (originalClientWidth != null) {
    Object.defineProperty(elementPrototype, 'clientWidth', originalClientWidth);
  }
  // Restore the ResizeObserver replacements on both targets so later suites
  // in the same process never observe the capturing stub.
  Object.assign(globalThis, { ResizeObserver: originalGlobalResizeObserver });
  Object.assign(dom.window, { ResizeObserver: originalWindowResizeObserver });
  dom.cleanup();
});

afterEach(() => {
  tree?.cleanUp();
  tree = undefined;
  nameClientWidth = 100;
  CapturingResizeObserver.callbacks = [];
});

const LONG_LEAF = 'VeryLongAccountName-Ending';
const ACCOUNTS = [`Assets:${LONG_LEAF}`, 'Expenses:Rent'];

interface Mounted {
  tree: AccountTree;
  rows: HTMLElement;
}

function mountTree(options: Partial<AccountTreeOptions> = {}): Mounted {
  const mounted = new AccountTree({ accounts: ACCOUNTS, ...options });
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

function nameElementFor(rows: HTMLElement, leaf: string): HTMLElement {
  for (const name of rows.querySelectorAll('[data-name]')) {
    if (
      name instanceof HTMLElement &&
      (name.textContent === leaf ||
        name.getAttribute('title') === leaf ||
        name.textContent?.endsWith(leaf.slice(-6)) === true)
    ) {
      return name;
    }
  }
  throw new Error(`name element for '${leaf}' missing`);
}

describe('middle truncation measurement pass', () => {
  test('overflowing names truncate keeping the leaf tail, with title', () => {
    const { tree: mounted } = mountTree({ nameTruncation: 'middle' });
    // Re-window with the geometry stubs in place (mirrors real mounting,
    // where the first measurable layout happens after render).
    mounted.expandAll();
    const rows = mountedRows();

    const longName = nameElementFor(rows, LONG_LEAF);
    const text = longName.textContent ?? '';
    // 26 chars at 10px into a 100px budget: 9-char budget → 2 head chars,
    // one ellipsis, 7 tail chars — the distinguishing tail survives.
    expect(text).toBe('Ve…-Ending');
    expect(text.length * PX_PER_CHAR).toBeLessThanOrEqual(nameClientWidth);
    expect(longName.getAttribute('title')).toBe(LONG_LEAF);
  });

  test('non-overflowing names stay untouched and carry no title', () => {
    const { tree: mounted } = mountTree({ nameTruncation: 'middle' });
    mounted.expandAll();
    const rows = mountedRows();

    const shortName = nameElementFor(rows, 'Rent');
    expect(shortName.textContent).toBe('Rent');
    expect(shortName.hasAttribute('title')).toBe(false);
    expect(shortName.dataset.truncated).toBeUndefined();
  });

  test("default 'end' mode never rewrites text or sets titles", () => {
    const { tree: mounted } = mountTree();
    mounted.expandAll();
    const rows = mountedRows();

    const longName = nameElementFor(rows, LONG_LEAF);
    expect(longName.textContent).toBe(LONG_LEAF);
    expect(longName.hasAttribute('title')).toBe(false);
  });

  test('patched-only commits (selection) skip the measurement pass', () => {
    const { tree: mounted } = mountTree({ nameTruncation: 'middle' });
    mounted.expandAll();
    const rows = mountedRows();

    const longName = nameElementFor(rows, LONG_LEAF);
    // Plant a sentinel: if a selection-only change re-ran the pass, the
    // sentinel would be re-truncated (its stored full width still says the
    // real name overflows).
    longName.textContent = 'SENTINEL';
    mounted.getController().selectPath('Expenses:Rent');
    expect(longName.textContent).toBe('SENTINEL');

    // A full window rebuild (expansion change) re-renders and re-measures.
    mounted.getController().setExpanded('Assets', false);
    mounted.getController().setExpanded('Assets', true);
    const remeasured = nameElementFor(mountedRows(), LONG_LEAF);
    expect(remeasured.textContent).toBe('Ve…-Ending');
  });

  test('container resize re-measures: grown rows restore the full name', () => {
    const { tree: mounted } = mountTree({ nameTruncation: 'middle' });
    mounted.expandAll();
    const rows = mountedRows();
    const longName = nameElementFor(rows, LONG_LEAF);
    expect(longName.textContent).toBe('Ve…-Ending');

    // Grow the name budget past the remembered full width (260px) and fire
    // the captured ResizeObserver callback: the pass restores the full
    // name and drops the tooltip (no longer truncated → no title noise).
    nameClientWidth = 400;
    for (const callback of CapturingResizeObserver.callbacks) {
      callback();
    }
    expect(longName.textContent).toBe(LONG_LEAF);
    expect(longName.hasAttribute('title')).toBe(false);
  });

  test('flattened chain labels truncate as their joined text', () => {
    const mounted = new AccountTree({
      accounts: ['Income:Sales:Consulting-Retainers'],
      flattenEmptyGroups: true,
      nameTruncation: 'middle',
    });
    mounted.render(document.body);
    tree = mounted;
    mounted.expandAll();
    const rows = mountedRows();

    // The chain row joins to 'Income : Sales' (14 chars → 140px > 100px).
    const chainName = rows.querySelector('[data-name][data-flattened="true"]');
    if (!(chainName instanceof HTMLElement)) {
      throw new Error('flattened name missing');
    }
    expect(chainName.getAttribute('title')).toBe('Income : Sales');
    expect(chainName.textContent).toContain('…');
    expect(chainName.textContent?.endsWith('Sales')).toBe(true);
  });

  test('rename still edits the full name, never the truncated text', () => {
    const { tree: mounted } = mountTree({ nameTruncation: 'middle' });
    mounted.expandAll();
    const rows = mountedRows();
    expect(nameElementFor(rows, LONG_LEAF).textContent).toBe('Ve…-Ending');

    mounted.beginRename(`Assets:${LONG_LEAF}`);
    const input = mountedRows().querySelector('[data-rename-input]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('rename input missing');
    }
    // The draft seeds from controller state (the real leaf name), not from
    // whatever presentation text the truncation pass left in the DOM.
    expect(input.value).toBe(LONG_LEAF);
  });
});

// The window rewrites on expansion changes, so tests re-query [data-rows]
// after any mutation instead of holding a stale reference.
function mountedRows(): HTMLElement {
  const rows = document.body
    .querySelector(ACCOUNTS_TAG_NAME)
    ?.shadowRoot?.querySelector('[data-rows]');
  if (!(rows instanceof HTMLElement)) {
    throw new Error('rows element missing');
  }
  return rows;
}
