// Search modes + match navigation. `expand-matches` (the default and the
// original behavior) is covered by AccountTreeController.expansion.test.ts;
// this suite covers the two additional modes — collapse-non-matches (minimal
// expansion) and hide-non-matches (filtered projection overlay) — plus the
// cyclic match navigation and the {index,total} readout.

import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountTreeChange } from '../src/types';
import { CHART_ACCOUNTS } from './domHarness';

function visiblePaths(controller: AccountTreeController): string[] {
  return [...controller.getVisiblePaths()];
}

describe('collapse-non-matches', () => {
  test('shows the minimal expansion revealing all matches', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();

    controller.beginSearch('cash', { mode: 'collapse-non-matches' });
    // Only the match ancestors (Assets, Assets:Current) stay expanded;
    // every group without a match in its subtree collapsed.
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Assets:Current',
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Assets:Fixed',
      'Expenses',
      'Income',
      'Liabilities',
    ]);
    expect(controller.getSearchMode()).toBe('collapse-non-matches');
  });

  test('endSearch restores the pre-session expansion snapshot', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.collapseAll();
    controller.setExpanded('Expenses', true);

    controller.beginSearch('cash', { mode: 'collapse-non-matches' });
    // Refining keeps the original snapshot AND the session mode.
    controller.beginSearch('ap');
    expect(controller.getSearchMode()).toBe('collapse-non-matches');
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Income',
      'Liabilities',
      'Liabilities:Current',
      'Liabilities:Current:AP',
    ]);

    controller.endSearch();
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Expenses:Rent',
      'Income',
      'Liabilities',
    ]);
    expect(controller.getSearchMode()).toBeNull();
  });

  test('an empty query restores the snapshot but keeps the session', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();
    controller.beginSearch('cash', { mode: 'collapse-non-matches' });
    expect(controller.getVisibleCount()).toBe(8);

    // Backspacing to empty must not leave the user with a fully collapsed
    // tree: the snapshot expansion returns while the session stays alive.
    const result = controller.beginSearch('');
    expect(result.matches).toEqual([]);
    expect(controller.getVisibleCount()).toBe(14);
    expect(controller.isSearchActive()).toBe(true);
  });
});

describe('hide-non-matches', () => {
  test('filters the projection to matches plus their ancestors', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();

    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Assets:Current',
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
    ]);
    // Filtered-out paths own no row but stay in the canonical topology.
    expect(controller.getPathIndex('Expenses')).toBe(-1);
    expect(controller.hasAccount('Expenses')).toBe(true);
    expect(controller.getAccountCount()).toBe(14);
  });

  test('recomputes posinset/setsize over the FILTERED visible siblings', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();

    controller.beginSearch('maybank', { mode: 'hide-non-matches' });
    const rows = controller.getRows(0, controller.getVisibleCount());
    expect(rows.map((row) => row.path)).toEqual([
      'Assets',
      'Assets:Current',
      'Assets:Current:Cash-Maybank',
    ]);
    // Assets is the only visible root (canonically 1 of 4); Cash-Maybank
    // the only visible child of Assets:Current (canonically 2 of 2).
    expect(rows[0].posInSet).toBe(1);
    expect(rows[0].setSize).toBe(1);
    expect(rows[2].posInSet).toBe(1);
    expect(rows[2].setSize).toBe(1);
    expect(rows[2].searchMatch).toBe(true);
  });

  test('a matchless query drops the filter instead of hiding everything', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();
    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(controller.getVisibleCount()).toBe(4);

    controller.beginSearch('zzz-no-such-account');
    expect(controller.getVisibleCount()).toBe(14);
    expect(controller.isSearchActive()).toBe(true);
  });

  test('endSearch restores the exact pre-session projection', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.collapseAll();
    controller.setExpanded('Income', true);

    controller.beginSearch('equipment', { mode: 'hide-non-matches' });
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Assets:Fixed',
      'Assets:Fixed:Equipment',
    ]);

    controller.endSearch();
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Income',
      'Income:Sales',
      'Liabilities',
    ]);
  });

  test('mode can switch mid-session without losing the snapshot', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.expandAll();
    controller.beginSearch('cash'); // Default expand-matches.
    expect(controller.getSearchMode()).toBe('expand-matches');
    expect(controller.getVisibleCount()).toBe(14);

    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(controller.getVisibleCount()).toBe(4);

    controller.endSearch();
    expect(controller.getVisibleCount()).toBe(14);
  });

  test('interacts with flattening: filtered chains stay flattened', () => {
    const controller = new AccountTreeController({
      accounts: CHART_ACCOUNTS,
      flattenEmptyGroups: true,
    });
    controller.expandAll();

    controller.beginSearch('consulting', { mode: 'hide-non-matches' });
    // Income → Income:Sales is a single-child group chain: one flattened
    // row keyed by the deepest group, then the matching leaf. The filter
    // admits the whole chain (both are ancestors of the match).
    expect(visiblePaths(controller)).toEqual([
      'Income:Sales',
      'Income:Sales:Consulting',
    ]);
    const rows = controller.getRows(0, 2);
    expect(rows[0].flattenedNames).toEqual(['Income', 'Sales']);
    expect(rows[1].posInSet).toBe(1);
    expect(rows[1].setSize).toBe(1);
  });
});

describe('match navigation', () => {
  test('cycles matches forward and backward in projection order', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.beginSearch('cash');

    expect(controller.focusNextSearchMatch()).toBe('Assets:Current:Cash-CIMB');
    expect(controller.focusNextSearchMatch()).toBe(
      'Assets:Current:Cash-Maybank'
    );
    // Cyclic: past the last match, wrap to the first.
    expect(controller.focusNextSearchMatch()).toBe('Assets:Current:Cash-CIMB');
    // And backward wraps the other way.
    expect(controller.focusPreviousSearchMatch()).toBe(
      'Assets:Current:Cash-Maybank'
    );
    expect(controller.getFocusedPath()).toBe('Assets:Current:Cash-Maybank');
  });

  test('a focused non-match anchors at the nearest upcoming match', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.beginSearch('cash');

    // Focus above both matches: "next" lands on the first, not the second.
    controller.setFocusedPath('Assets');
    expect(controller.getSearchMatchState()).toEqual({ index: 1, total: 2 });
    expect(controller.focusNextSearchMatch()).toBe('Assets:Current:Cash-CIMB');

    // Focus below both matches: "next" wraps to the first; "previous"
    // steps back to the nearest match above.
    controller.setFocusedPath('Expenses:Rent');
    expect(controller.getSearchMatchState()).toEqual({ index: 1, total: 2 });
    expect(controller.focusPreviousSearchMatch()).toBe(
      'Assets:Current:Cash-Maybank'
    );
  });

  test('reports {index,total} for the focused match', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    expect(controller.getSearchMatchState()).toBeNull();

    controller.beginSearch('cash');
    controller.focusNextSearchMatch();
    expect(controller.getSearchMatchState()).toEqual({ index: 1, total: 2 });
    controller.focusNextSearchMatch();
    expect(controller.getSearchMatchState()).toEqual({ index: 2, total: 2 });

    controller.beginSearch('zzz-no-such-account');
    expect(controller.getSearchMatchState()).toEqual({ index: 0, total: 0 });
    expect(controller.focusNextSearchMatch()).toBeNull();

    controller.endSearch();
    expect(controller.getSearchMatchState()).toBeNull();
    expect(controller.focusNextSearchMatch()).toBeNull();
  });

  test('navigation works over the filtered hide-non-matches projection', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.beginSearch('current', { mode: 'hide-non-matches' });
    // 'Current' matches both group segments AND their descendants (paths
    // carry the segment), in projection order.
    expect(controller.focusNextSearchMatch()).toBe('Assets:Current');
    expect(controller.focusNextSearchMatch()).toBe('Assets:Current:Cash-CIMB');
    const state = controller.getSearchMatchState();
    expect(state?.index).toBe(2);
    expect(state?.total).toBe(5);
  });
});

describe('change events', () => {
  test('search mutations report the searchChanged facet honestly', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));

    controller.beginSearch('cash', { mode: 'hide-non-matches' });
    expect(changes.at(-1)?.searchChanged).toBe(true);
    expect(changes.at(-1)?.expansionChanged).toBe(true);

    controller.focusNextSearchMatch();
    expect(changes.at(-1)?.searchChanged).toBe(false);
    expect(changes.at(-1)?.focusChanged).toBe(true);

    controller.endSearch();
    expect(changes.at(-1)?.searchChanged).toBe(true);

    // Non-search mutations never claim the facet.
    controller.setExpanded('Assets', false);
    expect(changes.at(-1)?.searchChanged).toBe(false);
  });
});
