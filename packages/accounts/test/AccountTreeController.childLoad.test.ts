import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import {
  getChildLoadPlaceholderParent,
  isChildLoadPlaceholderPath,
} from '../src/model/childLoadPlaceholder';

// Microtask/macrotask flush for the load promise chain.
function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const ACCOUNTS = [
  'Assets:Current:Cash',
  'Expenses:Rent',
  'Income:Sales',
  'Remote',
];

interface Harness {
  controller: AccountTreeController;
  calls: string[];
  deferreds: Deferred[];
  errors: Array<{ path: string; error: unknown }>;
}

function makeHarness(
  options: {
    accounts?: readonly string[];
    initiallyUnloaded?: readonly string[];
    flattenEmptyGroups?: boolean;
  } = {}
): Harness {
  const calls: string[] = [];
  const deferreds: Deferred[] = [];
  const errors: Array<{ path: string; error: unknown }> = [];
  const controller = new AccountTreeController({
    accounts: options.accounts ?? ACCOUNTS,
    initiallyUnloaded: options.initiallyUnloaded ?? ['Remote'],
    flattenEmptyGroups: options.flattenEmptyGroups ?? false,
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
  return { controller, calls, deferreds, errors };
}

describe('unloaded groups in the projection', () => {
  test('render as collapsed groups even with zero children', () => {
    const { controller } = makeHarness();
    const index = controller.getPathIndex('Remote');
    expect(index).toBeGreaterThanOrEqual(0);
    const row = controller.getRows(index, index + 1)[0];
    expect(row.kind).toBe('group');
    expect(row.expanded).toBe(false);
    expect(row.childLoadState).toBe('unloaded');
  });

  test('expandAll skips unloaded groups (no load fan-out)', () => {
    const { controller, calls } = makeHarness();
    controller.collapseAll();
    controller.expandAll();
    expect(calls).toEqual([]);
    expect(controller.isExpanded('Remote')).toBe(false);
    expect(controller.isExpanded('Assets')).toBe(true);
  });
});

describe('expand-triggered loading', () => {
  test('one expand gesture starts exactly one load', () => {
    const { controller, calls } = makeHarness();
    controller.setExpanded('Remote', true);
    expect(calls).toEqual(['Remote']);
    // Collapse/re-expand while the load is in flight must not re-fetch.
    controller.setExpanded('Remote', false);
    controller.setExpanded('Remote', true);
    expect(calls).toEqual(['Remote']);
    expect(controller.getChildLoadState('Remote').state).toBe('loading');
  });

  test('an expanded loading group projects one placeholder row', () => {
    const { controller } = makeHarness();
    controller.setExpanded('Remote', true);
    const visible = controller.getVisiblePaths();
    const parentIndex = controller.getPathIndex('Remote');
    const marker = visible[parentIndex + 1];
    expect(isChildLoadPlaceholderPath(marker)).toBe(true);
    expect(getChildLoadPlaceholderParent(marker)).toBe('Remote');
    const row = controller.getRows(parentIndex + 1, parentIndex + 2)[0];
    expect(row.loadPlaceholder).toEqual({
      parentPath: 'Remote',
      state: 'loading',
      error: null,
    });
    // The marker is not an account: index lookups degrade gracefully.
    expect(controller.getPathIndex(marker)).toBe(-1);
    expect(controller.hasAccount(marker)).toBe(false);
  });

  test('resolve inserts the children and drops the placeholder', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].resolve(['Remote:Beta', 'Remote:Alpha:Deep']);
    await wait(0);
    expect(controller.getChildLoadState('Remote')).toEqual({
      state: 'loaded',
    });
    const visible = controller.getVisiblePaths();
    expect(visible.some(isChildLoadPlaceholderPath)).toBe(false);
    // Auto-ancestors + code-point sibling order, exactly addAccounts.
    const remoteIndex = controller.getPathIndex('Remote');
    expect(visible.slice(remoteIndex, remoteIndex + 4)).toEqual([
      'Remote',
      'Remote:Alpha',
      'Remote:Alpha:Deep',
      'Remote:Beta',
    ]);
  });

  test('loaded children survive a later remap rebuild', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].resolve(['Remote:Kid']);
    await wait(0);
    // Renaming an unrelated path rebuilds the store from the controller's
    // inputs; the absorbed children must be part of those inputs now.
    const result = controller.commitRename('Expenses:Rent', 'Rental');
    expect(result.ok).toBe(true);
    expect(controller.hasAccount('Remote:Kid')).toBe(true);
    expect(controller.getPathIndex('Remote:Kid')).toBeGreaterThanOrEqual(0);
  });
});

describe('failed loads', () => {
  test('reject renders the error placeholder and fires onChildLoadError', async () => {
    const { controller, deferreds, errors } = makeHarness();
    controller.setExpanded('Remote', true);
    const boom = new Error('gateway timeout');
    deferreds[0].reject(boom);
    await wait(0);
    expect(errors).toEqual([{ path: 'Remote', error: boom }]);
    expect(controller.getChildLoadState('Remote')).toEqual({
      state: 'error',
      error: 'gateway timeout',
    });
    const parentIndex = controller.getPathIndex('Remote');
    const row = controller.getRows(parentIndex + 1, parentIndex + 2)[0];
    expect(row.loadPlaceholder).toEqual({
      parentPath: 'Remote',
      state: 'error',
      error: 'gateway timeout',
    });
  });

  test('re-expanding an error group does not auto-retry', async () => {
    const { controller, calls, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].reject(new Error('boom'));
    await wait(0);
    controller.setExpanded('Remote', false);
    controller.setExpanded('Remote', true);
    expect(calls).toEqual(['Remote']); // retry is the explicit button only
  });

  test('requestChildLoad retries an error state and can then succeed', async () => {
    const { controller, calls, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].reject(new Error('boom'));
    await wait(0);
    expect(controller.requestChildLoad('Remote')).toBe(true);
    expect(calls).toEqual(['Remote', 'Remote']);
    deferreds[1].resolve(['Remote:Kid']);
    await wait(0);
    expect(controller.getChildLoadState('Remote')).toEqual({
      state: 'loaded',
    });
    expect(controller.hasAccount('Remote:Kid')).toBe(true);
  });
});

describe('stale-response gating', () => {
  test('a resolution after cancelChildLoads is discarded', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    controller.cancelChildLoads();
    expect(controller.getChildLoadState('Remote').state).toBe('unloaded');
    deferreds[0].resolve(['Remote:Kid']);
    await wait(0);
    expect(controller.hasAccount('Remote:Kid')).toBe(false);
    expect(controller.getChildLoadState('Remote').state).toBe('unloaded');
  });

  test('an older attempt resolving after a newer retry is discarded', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].reject(new Error('boom'));
    await wait(0);
    controller.requestChildLoad('Remote'); // attempt 2, in flight
    // Attempt 1's deferred is already settled; simulate the inverse order
    // with a third attempt: retry #2 fails late AFTER retry #3 started.
    const secondDeferred = deferreds[1];
    controller.cancelChildLoads();
    controller.requestChildLoad('Remote'); // attempt 3
    secondDeferred.resolve(['Remote:Stale']);
    await wait(0);
    // Attempt 2 was superseded: its children must not materialize and the
    // machine must still be waiting on attempt 3.
    expect(controller.hasAccount('Remote:Stale')).toBe(false);
    expect(controller.getChildLoadState('Remote').state).toBe('loading');
    deferreds[2].resolve(['Remote:Fresh']);
    await wait(0);
    expect(controller.hasAccount('Remote:Fresh')).toBe(true);
  });

  test('a resolution after the path moved is discarded, state follows move', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    const result = controller.commitRename('Remote', 'Archive');
    expect(result.ok).toBe(true);
    // The moved path resets to unloaded (fresh gesture re-triggers), and
    // the old attempt's resolution must not land anywhere.
    expect(controller.getChildLoadState('Archive').state).toBe('unloaded');
    deferreds[0].resolve(['Remote:Kid']);
    await wait(0);
    expect(controller.hasAccount('Remote:Kid')).toBe(false);
    expect(controller.hasAccount('Archive:Kid')).toBe(false);
  });

  test('error state survives an unrelated remap rebuild', async () => {
    const { controller, deferreds } = makeHarness();
    controller.setExpanded('Remote', true);
    deferreds[0].reject(new Error('flaky'));
    await wait(0);
    const result = controller.commitRename('Expenses:Rent', 'Rental');
    expect(result.ok).toBe(true);
    expect(controller.getChildLoadState('Remote')).toEqual({
      state: 'error',
      error: 'flaky',
    });
    // Still expanded, so the error placeholder still projects.
    const parentIndex = controller.getPathIndex('Remote');
    const marker = controller.getVisiblePaths()[parentIndex + 1];
    expect(getChildLoadPlaceholderParent(marker)).toBe('Remote');
  });
});

describe('keyboard and selection skip placeholders', () => {
  test('moveFocus steps over the placeholder row', () => {
    const { controller } = makeHarness();
    controller.setExpanded('Remote', true);
    const parentIndex = controller.getPathIndex('Remote');
    controller.setFocusedPath('Remote');
    // 'Remote' sorts last here, so the placeholder is the final row: focus
    // stays put rather than landing on it.
    expect(controller.getVisiblePaths().length).toBe(parentIndex + 2);
    expect(controller.moveFocus(1)).toBe('Remote');
    // Walking up from below the group skips the placeholder too.
    controller.focusIndex(parentIndex + 1);
    expect(controller.getFocusedPath()).toBe('Remote');
  });

  test('type-ahead never lands on a placeholder', () => {
    const { controller } = makeHarness();
    controller.setExpanded('Remote', true);
    controller.setFocusedPath('Remote');
    // The very next row is the placeholder, whose marker string embeds
    // 'Remote' — a leaf name that would match 'r' if type-ahead failed to
    // skip it. The cyclic search must wrap past it to the first real
    // r-name instead.
    expect(controller.focusByTypeAhead('r')).toBe('Expenses:Rent');
  });

  test('shift-range selection over a placeholder excludes it', () => {
    const { controller } = makeHarness();
    controller.setExpanded('Remote', true);
    controller.selectPath('Income:Sales');
    controller.selectPath('Remote', { range: true });
    const selected = controller.getSelectedPaths();
    expect(selected).toContain('Remote');
    expect(selected.some(isChildLoadPlaceholderPath)).toBe(false);
  });
});

describe('search and flatten interplay', () => {
  test('hide-non-matches keeps an unloaded group only when it matches itself', () => {
    const { controller } = makeHarness();
    // Search cannot see unfetched children: 'Remote' owns no descendants
    // yet, so a query matching only other subtrees hides it.
    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(controller.getPathIndex('Remote')).toBe(-1);
    // A query matching the group itself keeps it visible.
    controller.beginSearch('remote', { mode: 'hide-non-matches' });
    expect(controller.getPathIndex('Remote')).toBeGreaterThanOrEqual(0);
    controller.endSearch();
  });

  test('flatten never flattens through an unloaded group', () => {
    const { controller } = makeHarness({
      accounts: ['Wrap:Only:Kid'],
      initiallyUnloaded: ['Wrap:Only'],
      flattenEmptyGroups: true,
    });
    // Without the guard the single-child chain Wrap → Wrap:Only would merge
    // into one row keyed 'Wrap:Only'; the unloaded group must instead stay
    // a distinct row so its placeholder/affordance has an honest anchor.
    expect(controller.getPathIndex('Wrap')).toBeGreaterThanOrEqual(0);
    const wrapRow = controller.getRow('Wrap');
    expect(wrapRow?.flattenedNames ?? null).toBeNull();
  });
});
