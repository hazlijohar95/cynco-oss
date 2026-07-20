import { describe, expect, test } from 'bun:test';

import { AccountStore } from '../src/AccountStore';
import type { MutationEvent } from '../src/types';

// A small chart with one leaf ('Expenses:Rent'), one deep branch, and a
// dedicated lazy group ('Remote') that carries no children of its own — the
// canonical unloaded shape.
const ACCOUNTS = [
  'Assets:Current:Cash',
  'Expenses:Rent',
  'Income:Sales',
  'Remote',
];

function buildStore(): AccountStore {
  return new AccountStore({ accountPaths: ACCOUNTS });
}

// The observable end state: every visible row as `path(kind,expanded)`.
function visibleRows(store: AccountStore): string[] {
  return store
    .getVisibleSlice(0, store.getVisibleCount())
    .map((row) => `${row.path}(${row.kind}${row.expanded ? ',open' : ''})`);
}

describe('child-load state machine', () => {
  test('every path defaults to loaded, including unknown paths', () => {
    const store = buildStore();
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loaded' });
    expect(store.getChildLoadState('Assets')).toEqual({ state: 'loaded' });
    expect(store.getChildLoadState('No:Such:Path')).toEqual({
      state: 'loaded',
    });
  });

  test('markUnloaded transitions existing paths and ignores unknown ones', () => {
    const store = buildStore();
    store.markUnloaded(['Remote', 'No:Such:Path', '']);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'unloaded' });
    expect(store.getChildLoadState('No:Such:Path')).toEqual({
      state: 'loaded',
    });
  });

  test('beginChildLoad only accepts unloaded and error states', () => {
    const store = buildStore();
    // loaded → loading: refused (nothing was declared unfetched).
    expect(store.beginChildLoad('Remote')).toBe(false);
    // unknown path: refused.
    expect(store.beginChildLoad('No:Such:Path')).toBe(false);
    store.markUnloaded(['Remote']);
    expect(store.beginChildLoad('Remote')).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loading' });
    // loading → loading: refused (one load in flight at a time).
    expect(store.beginChildLoad('Remote')).toBe(false);
    // error → loading: the retry transition.
    store.failChildLoad('Remote', 'boom');
    expect(store.beginChildLoad('Remote')).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loading' });
  });

  test('completeChildLoad outside the loading state is a rejected no-op', () => {
    const store = buildStore();
    const before = store.getAccountCount();
    for (const path of ['Remote', 'No:Such:Path']) {
      const result = store.completeChildLoad(path, ['Remote:Kid']);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('not-loading');
      expect(result.added).toEqual([]);
    }
    store.markUnloaded(['Remote']);
    // unloaded (no load in flight) → still rejected.
    expect(store.completeChildLoad('Remote', ['Remote:Kid']).ok).toBe(false);
    expect(store.getAccountCount()).toBe(before);
  });

  test('failChildLoad outside the loading state is a silent no-op', () => {
    const store = buildStore();
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));
    store.failChildLoad('Remote', 'nope');
    store.markUnloaded(['Remote']);
    store.failChildLoad('Remote', 'nope');
    expect(events).toEqual([]);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'unloaded' });
  });

  test('markUnloaded force-resets any state, refusing the stale completion', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    // The caller reset the machine while a load was in flight (cancel).
    store.markUnloaded(['Remote']);
    const stale = store.completeChildLoad('Remote', ['Remote:Kid']);
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('not-loading');
    expect(store.hasAccount('Remote:Kid')).toBe(false);
  });
});

describe('completeChildLoad', () => {
  test('adds children with addAccounts semantics and one honest event', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.setExpanded('Remote', true);
    store.beginChildLoad('Remote');
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));

    const result = store.completeChildLoad('Remote', [
      'Remote:Deep:Leaf',
      'not::valid',
      'Remote:Alpha',
    ]);
    expect(result.ok).toBe(true);
    // Auto-ancestors, invalid skipped — exactly addAccounts.
    expect(result.added).toEqual([
      'Remote:Deep',
      'Remote:Deep:Leaf',
      'Remote:Alpha',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].topology?.addedPaths).toEqual(result.added);
    expect(events[0].childLoad).toEqual({ path: 'Remote', state: 'loaded' });
    expect(events[0].accountsChanged).toContain('Remote');

    // Children queryable + machine back to the default state.
    expect(store.hasAccount('Remote:Alpha')).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loaded' });
    expect(visibleRows(store)).toContain('Remote:Alpha(leaf)');
  });

  test('an empty load still emits the transition and demotes to leaf', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));
    const result = store.completeChildLoad('Remote', []);
    expect(result.ok).toBe(true);
    expect(result.added).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].childLoad).toEqual({ path: 'Remote', state: 'loaded' });
    // No children materialized: the path honestly renders as a leaf again.
    expect(visibleRows(store)).toContain('Remote(leaf)');
  });
});

describe('failChildLoad', () => {
  test('remembers the error message and emits a childLoad-only event', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));
    store.failChildLoad('Remote', 'network unreachable');
    expect(events).toHaveLength(1);
    expect(events[0].topology).toBeUndefined();
    expect(events[0].childLoad).toEqual({
      path: 'Remote',
      state: 'error',
      error: 'network unreachable',
    });
    expect(events[0].accountsChanged).toEqual(['Remote']);
    expect(store.getChildLoadState('Remote')).toEqual({
      state: 'error',
      error: 'network unreachable',
    });
  });

  test('retry via beginChildLoad clears the remembered error', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    store.failChildLoad('Remote', 'boom');
    expect(store.beginChildLoad('Remote')).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loading' });
    const result = store.completeChildLoad('Remote', ['Remote:Kid']);
    expect(result.ok).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loaded' });
  });
});

describe('load state and the canonical tier', () => {
  test('survives an unrelated topology mutation (derived rebuild)', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    store.addAccounts(['Equity:Opening']); // drops the derived tier
    expect(visibleRows(store)).toContain('Remote(group)'); // forces rebuild
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loading' });
  });

  test('follows moveAccount like expansion does', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    store.failChildLoad('Remote', 'flaky');
    const result = store.moveAccount('Remote', 'Assets:Remote');
    expect(result.ok).toBe(true);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loaded' });
    expect(store.getChildLoadState('Assets:Remote')).toEqual({
      state: 'error',
      error: 'flaky',
    });
  });

  test('removeAccounts drops the load state with the subtree', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.removeAccounts(['Remote']);
    expect(store.getChildLoadState('Remote')).toEqual({ state: 'loaded' });
    // Re-adding the same path starts from the default state.
    store.addAccounts(['Remote']);
    expect(store.beginChildLoad('Remote')).toBe(false);
  });
});

describe('projection honesty', () => {
  test('an unloaded zero-child path renders as an expandable group', () => {
    const store = buildStore();
    store.markUnloaded(['Remote', 'Expenses:Rent']);
    const rows = store.getVisibleSlice(0, store.getVisibleCount());
    const remote = rows.find((row) => row.path === 'Remote');
    const rent = rows.find((row) => row.path === 'Expenses:Rent');
    expect(remote?.kind).toBe('group');
    expect(rent?.kind).toBe('group');
    // markUnloaded collapses (children unknown; the expand gesture is the
    // load trigger), and expansion works through the group-ness seam.
    expect(remote?.expanded).toBe(false);
    store.setExpanded('Remote', true);
    expect(store.isExpanded('Remote')).toBe(true);
  });

  test('loading and error states keep the group affordance', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.beginChildLoad('Remote');
    expect(visibleRows(store)).toContain('Remote(group)');
    store.failChildLoad('Remote', 'boom');
    expect(visibleRows(store)).toContain('Remote(group)');
  });

  test('expandAll skips unloaded zero-child groups (no load fan-out)', () => {
    const store = buildStore();
    store.markUnloaded(['Remote']);
    store.collapseAll();
    store.expandAll();
    // Real groups open; the unloaded group stays collapsed — expandAll must
    // never imply N network fetches at the view layer above.
    expect(store.isExpanded('Assets')).toBe(true);
    expect(store.isExpanded('Remote')).toBe(false);
  });
});
