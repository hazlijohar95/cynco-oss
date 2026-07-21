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
  dispatchKey,
  type DomHandle,
  installDom,
  stubScrollerGeometry,
  wait,
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

const LAZY_ACCOUNTS = [
  'Assets:Current:Cash',
  'Expenses:Rent',
  'Income:Sales',
  'Remote',
];

/** A promise with its settle functions exposed — the fake network. */
interface Deferred {
  promise: Promise<readonly string[]>;
  resolve(children: readonly string[]): void;
  reject(error: unknown): void;
}

function makeDeferred(): Deferred {
  let resolve!: (children: readonly string[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<readonly string[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Mounted {
  tree: AccountTree;
  scroller: HTMLElement;
  calls: string[];
  deferreds: Deferred[];
  errors: Array<{ path: string; error: unknown }>;
}

function mountTree(): Mounted {
  const calls: string[] = [];
  const deferreds: Deferred[] = [];
  const errors: Array<{ path: string; error: unknown }> = [];
  const mounted = new AccountTree({
    accounts: LAZY_ACCOUNTS,
    initiallyUnloaded: ['Remote'],
    loadChildren: (path) => {
      calls.push(path);
      const deferred = makeDeferred();
      deferreds.push(deferred);
      return deferred.promise;
    },
    onChildLoadError: (path, error) => {
      errors.push({ path, error });
    },
  });
  mounted.render(document.body);
  tree = mounted;
  const container = document.body.querySelector(ACCOUNTS_TAG_NAME);
  const scroller = container?.shadowRoot?.querySelector('[data-scroller]');
  if (!(scroller instanceof HTMLElement)) {
    throw new Error('mountTree: scroller missing');
  }
  stubScrollerGeometry(scroller, { height: 300, scrollHeight: 420 });
  return { tree: mounted, scroller, calls, deferreds, errors };
}

function getRowByPath(mounted: Mounted, path: string): HTMLElement {
  const index = mounted.tree.getController().getPathIndex(path);
  const row = mounted.scroller.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row for ${path} not rendered`);
  }
  return row;
}

function click(element: Element): void {
  element.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true })
  );
}

function queryPlaceholder(mounted: Mounted): HTMLElement | null {
  const placeholder = mounted.scroller.querySelector('[data-load-placeholder]');
  return placeholder instanceof HTMLElement ? placeholder : null;
}

describe('unloaded group rendering', () => {
  test('renders as a collapsed group with a chevron', () => {
    const mounted = mountTree();
    const row = getRowByPath(mounted, 'Remote');
    expect(row.getAttribute('data-kind')).toBe('group');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('[data-chevron] svg')).not.toBeNull();
    expect(row.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('expand gestures trigger the load', () => {
  test('chevron click starts exactly one load and renders the loading row', () => {
    const mounted = mountTree();
    const chevron = getRowByPath(mounted, 'Remote').querySelector(
      '[data-chevron]'
    );
    expect(chevron).not.toBeNull();
    click(chevron as Element);
    expect(mounted.calls).toEqual(['Remote']);

    // Group row announces busy; the visual placeholder row is aria-hidden
    // (no child rows exist yet, so no aria-setsize story to fake).
    const groupRow = getRowByPath(mounted, 'Remote');
    expect(groupRow.getAttribute('aria-busy')).toBe('true');
    const placeholder = queryPlaceholder(mounted);
    expect(placeholder?.getAttribute('data-load-placeholder')).toBe('loading');
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    expect(
      placeholder?.querySelectorAll('[data-load-dots] > span')
    ).toHaveLength(3);
    // Not a treeitem: no role, never selectable.
    expect(placeholder?.getAttribute('role')).toBeNull();

    // Collapsing and re-expanding while in flight must not re-fetch.
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    expect(mounted.calls).toEqual(['Remote']);
  });

  test('ArrowRight on the focused unloaded group triggers the load', () => {
    const mounted = mountTree();
    mounted.tree.getController().setFocusedPath('Remote');
    dispatchKey(mounted.scroller, 'ArrowRight');
    expect(mounted.calls).toEqual(['Remote']);
    expect(mounted.tree.getController().isExpanded('Remote')).toBe(true);
  });

  test('expandAll skips unloaded groups — one gesture must not fan out fetches', () => {
    const mounted = mountTree();
    mounted.tree.collapseAll();
    mounted.tree.expandAll();
    expect(mounted.calls).toEqual([]);
    expect(getRowByPath(mounted, 'Remote').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(getRowByPath(mounted, 'Assets').getAttribute('aria-expanded')).toBe(
      'true'
    );
  });
});

describe('load resolution', () => {
  test('resolve swaps the placeholder for real child rows', async () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    mounted.deferreds[0].resolve(['Remote:Beta', 'Remote:Alpha']);
    await wait(0);
    expect(queryPlaceholder(mounted)).toBeNull();
    expect(getRowByPath(mounted, 'Remote').hasAttribute('aria-busy')).toBe(
      false
    );
    // Children render through the normal projection/window path, sorted.
    const alpha = getRowByPath(mounted, 'Remote:Alpha');
    const beta = getRowByPath(mounted, 'Remote:Beta');
    expect(alpha.getAttribute('aria-level')).toBe('2');
    expect(Number(alpha.getAttribute('data-row-index'))).toBeLessThan(
      Number(beta.getAttribute('data-row-index'))
    );
  });
});

describe('load failure and retry', () => {
  test('reject renders the error row; Retry re-runs the load', async () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    mounted.deferreds[0].reject(new Error('gateway timeout'));
    await wait(0);

    expect(mounted.errors).toHaveLength(1);
    const errorRow = queryPlaceholder(mounted);
    expect(errorRow?.getAttribute('data-load-placeholder')).toBe('error');
    // The error row is NOT aria-hidden — its Retry button must be reachable.
    expect(errorRow?.hasAttribute('aria-hidden')).toBe(false);
    expect(errorRow?.textContent).toContain('gateway timeout');
    // Group row dropped aria-busy.
    expect(getRowByPath(mounted, 'Remote').hasAttribute('aria-busy')).toBe(
      false
    );

    const retry = errorRow?.querySelector('[data-load-retry]');
    expect(retry).toBeInstanceOf(window.HTMLButtonElement);
    // The deliberate roving-tabindex exception: the row is not a treeitem,
    // so the only recovery control gets a real tab stop.
    expect(retry?.getAttribute('tabindex')).toBe('0');
    expect(retry?.getAttribute('aria-label')).toBe('Retry loading Remote');

    click(retry as Element);
    expect(mounted.calls).toEqual(['Remote', 'Remote']);
    expect(
      queryPlaceholder(mounted)?.getAttribute('data-load-placeholder')
    ).toBe('loading');
    mounted.deferreds[1].resolve(['Remote:Kid']);
    await wait(0);
    expect(queryPlaceholder(mounted)).toBeNull();
    expect(getRowByPath(mounted, 'Remote:Kid')).toBeInstanceOf(
      window.HTMLElement
    );
  });

  test('clicking elsewhere on the error row selects nothing', async () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    mounted.deferreds[0].reject(new Error('boom'));
    await wait(0);
    const errorRow = queryPlaceholder(mounted);
    click(errorRow as Element);
    expect(mounted.tree.getSelectedPaths()).toEqual([]);
    expect(mounted.calls).toEqual(['Remote']); // no accidental retry either
  });
});

describe('stale-response gating', () => {
  test('a resolution after cleanUp is discarded', async () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    const controller = mounted.tree.getController();
    mounted.tree.cleanUp();
    tree = undefined;
    mounted.deferreds[0].resolve(['Remote:Kid']);
    await wait(0);
    expect(controller.hasAccount('Remote:Kid')).toBe(false);
    expect(controller.getChildLoadState('Remote').state).toBe('unloaded');
  });

  test('an older attempt resolving after a newer retry is discarded', async () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    mounted.deferreds[0].reject(new Error('boom'));
    await wait(0);
    // Retry, then let the FIRST retry's sibling attempt lose the race: the
    // second attempt is superseded by a third before it resolves.
    const placeholder = queryPlaceholder(mounted);
    if (placeholder == null) throw new Error('expected a retry placeholder');
    click(placeholder.querySelector('[data-load-retry]')!);
    const second = mounted.deferreds[1];
    mounted.tree.getController().cancelChildLoads();
    mounted.tree.getController().requestChildLoad('Remote');
    second.resolve(['Remote:Stale']);
    await wait(0);
    expect(mounted.tree.getController().hasAccount('Remote:Stale')).toBe(false);
    mounted.deferreds[2].resolve(['Remote:Fresh']);
    await wait(0);
    expect(mounted.tree.getController().hasAccount('Remote:Fresh')).toBe(true);
  });
});

describe('keyboard interaction around placeholders', () => {
  test('arrow navigation skips the placeholder row', () => {
    const mounted = mountTree();
    click(getRowByPath(mounted, 'Remote').querySelector('[data-chevron]')!);
    // 'Remote' sorts last, so its placeholder is the final visible row:
    // End must land on the group, not the placeholder.
    dispatchKey(mounted.scroller, 'End');
    expect(mounted.tree.getFocusedPath()).toBe('Remote');
    dispatchKey(mounted.scroller, 'ArrowDown');
    expect(mounted.tree.getFocusedPath()).toBe('Remote');
  });
});

describe('search and flatten interplay (view smoke)', () => {
  test('hide-non-matches hides the unloaded group unless it matches', () => {
    const mounted = mountTree();
    const controller = mounted.tree.getController();
    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(controller.getPathIndex('Remote')).toBe(-1);
    controller.beginSearch('remote', { mode: 'hide-non-matches' });
    expect(getRowByPath(mounted, 'Remote').getAttribute('data-kind')).toBe(
      'group'
    );
    controller.endSearch();
  });

  test('flatten keeps the unloaded group as its own row', () => {
    const mounted = mountTree();
    mounted.tree.setFlattenEmptyGroups(true);
    // 'Remote' is top-level with no single-child chain here; the meaningful
    // controller-level guarantee is covered in the controller suite — this
    // smoke test just proves the flattened projection still renders the
    // unloaded group with its chevron affordance.
    const row = getRowByPath(mounted, 'Remote');
    expect(row.getAttribute('data-kind')).toBe('group');
    expect(row.hasAttribute('data-flattened-row')).toBe(false);
  });
});
