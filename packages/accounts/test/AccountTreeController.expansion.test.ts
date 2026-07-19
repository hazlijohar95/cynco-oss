import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountTreeChange } from '../src/types';
import { CHART_ACCOUNTS, makeChartEntries } from './domHarness';

// Compact projection: visible paths in render order.
function visiblePaths(controller: AccountTreeController): readonly string[] {
  return controller.getVisiblePaths();
}

describe('initialExpansion', () => {
  test("'all' (default) shows every account", () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    expect(controller.getAccountCount()).toBe(14);
    expect(controller.getVisibleCount()).toBe(14);
  });

  test("'top-level' expands only depth-0 groups", () => {
    const controller = new AccountTreeController({
      accounts: CHART_ACCOUNTS,
      initialExpansion: 'top-level',
    });
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Assets:Current',
      'Assets:Fixed',
      'Expenses',
      'Expenses:Rent',
      'Income',
      'Income:Sales',
      'Liabilities',
      'Liabilities:Current',
    ]);
  });

  test('explicit path list expands the listed groups plus ancestors', () => {
    const controller = new AccountTreeController({
      accounts: CHART_ACCOUNTS,
      initialExpansion: ['Assets:Current'],
    });
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
  });
});

describe('setExpanded', () => {
  test('collapsing a group hides its whole subtree', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setExpanded('Assets', false);
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Expenses:Rent',
      'Income',
      'Income:Sales',
      'Income:Sales:Consulting',
      'Liabilities',
      'Liabilities:Current',
      'Liabilities:Current:AP',
    ]);
    controller.setExpanded('Assets', true);
    expect(controller.getVisibleCount()).toBe(14);
  });

  test('fires honest expansion events and skips no-ops', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));

    controller.setExpanded('Assets', true); // Already expanded: no event.
    expect(changes.length).toBe(0);

    controller.setExpanded('Assets', false);
    expect(changes.length).toBe(1);
    expect(changes[0]).toEqual({
      expansionChanged: true,
      selectionChanged: false,
      statusChanged: false,
      focusChanged: false,
      renameChanged: false,
      searchChanged: false,
    });

    controller.setExpanded('Assets:Current:Cash-CIMB', false); // Leaf: no-op.
    expect(changes.length).toBe(1);
  });

  test('expandAll / collapseAll round-trip', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.collapseAll();
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Income',
      'Liabilities',
    ]);
    controller.expandAll();
    expect(controller.getVisibleCount()).toBe(14);
  });
});

describe('search sessions', () => {
  test('matches path segments case-insensitively and auto-expands ancestors', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.collapseAll();

    const result = controller.beginSearch('CASH');
    expect(result.matches).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
    ]);
    expect([...result.expandedAncestors].sort()).toEqual([
      'Assets',
      'Assets:Current',
    ]);
    // The matches became visible; unrelated groups stayed collapsed.
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
    expect(controller.isSearchActive()).toBe(true);
  });

  test('matches group segments — descendants share the matching segment', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    const result = controller.beginSearch('sales');
    // Every path carrying a matching segment matches, so descendants of a
    // matching group are matches too (their path contains the segment).
    expect(result.matches).toEqual(['Income:Sales', 'Income:Sales:Consulting']);
  });

  test('endSearch restores the exact prior expansion', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.collapseAll();
    controller.setExpanded('Expenses', true);

    controller.beginSearch('cash');
    // Refining the query keeps the original snapshot.
    controller.beginSearch('ap');
    controller.endSearch();

    expect(controller.isSearchActive()).toBe(false);
    expect(visiblePaths(controller)).toEqual([
      'Assets',
      'Expenses',
      'Expenses:Rent',
      'Income',
      'Liabilities',
    ]);
  });

  test('empty query matches nothing but keeps the session alive', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    const result = controller.beginSearch('');
    expect(result.matches).toEqual([]);
    expect(controller.isSearchActive()).toBe(true);
  });
});

describe('setEntries', () => {
  test('rebuilds the tree and preserves collapsed state for surviving groups', () => {
    const controller = new AccountTreeController({
      entries: makeChartEntries(),
    });
    controller.setExpanded('Assets', false);

    // New data adds an account; Assets stays collapsed.
    const entries = [
      ...makeChartEntries(),
      {
        id: 'e4',
        date: '2026-07-04',
        flag: 'cleared' as const,
        payee: null,
        narration: 'New expense head',
        tags: [],
        links: [],
        postings: [
          { account: 'Expenses:Software', amount: 9_900, currency: 'MYR' },
          {
            account: 'Assets:Current:Cash-Maybank',
            amount: -9_900,
            currency: 'MYR',
          },
        ],
      },
    ];
    controller.setEntries(entries);

    expect(controller.hasAccount('Expenses:Software')).toBe(true);
    expect(controller.isExpanded('Assets')).toBe(false);
    expect(controller.getVisiblePaths()).toContain('Expenses:Software');
  });

  test('drops selection and focus for vanished paths', () => {
    const controller = new AccountTreeController({
      entries: makeChartEntries(),
    });
    controller.selectPath('Expenses:Rent');
    controller.setEntries([makeChartEntries()[0]]); // Only e1 remains.
    expect(controller.hasAccount('Expenses:Rent')).toBe(false);
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getFocusedPath()).toBeNull();
  });
});
