import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import { renderAccountRowHTML } from '../src/render/AccountTreeRenderer';
import type { AccountTreeChange } from '../src/types';
import { CHART_ACCOUNTS, makeChartEntries } from './domHarness';

function makeFlatController(): AccountTreeController {
  return new AccountTreeController({
    accounts: CHART_ACCOUNTS,
    entries: makeChartEntries(),
    flattenEmptyGroups: true,
  });
}

// Compact projection: 'path depth=N [chain=A:B]'.
function project(controller: AccountTreeController): string[] {
  return controller.getRows(0, controller.getVisibleCount()).map((row) => {
    const chain =
      row.flattenedNames == null
        ? ''
        : ` chain=${row.flattenedNames.join(':')}`;
    return `${row.path} depth=${row.depth}${chain}`;
  });
}

describe('flattenEmptyGroups projection', () => {
  test('single-child group chains collapse into one row keyed by the deepest group', () => {
    const controller = makeFlatController();
    expect(project(controller)).toEqual([
      'Assets depth=0',
      'Assets:Current depth=1',
      'Assets:Current:Cash-CIMB depth=2',
      'Assets:Current:Cash-Maybank depth=2',
      'Assets:Fixed depth=1',
      'Assets:Fixed:Equipment depth=2',
      'Expenses depth=0',
      'Expenses:Rent depth=1',
      'Income:Sales depth=0 chain=Income:Sales',
      'Income:Sales:Consulting depth=1',
      'Liabilities:Current depth=0 chain=Liabilities:Current',
      'Liabilities:Current:AP depth=1',
    ]);
    expect(controller.getVisibleCount()).toBe(12);
  });

  test('chains extend across multiple levels, stopping before leaf-only groups', () => {
    const controller = new AccountTreeController({
      accounts: ['X:Y:Z:W'],
      flattenEmptyGroups: true,
    });
    expect(project(controller)).toEqual([
      'X:Y:Z depth=0 chain=X:Y:Z',
      'X:Y:Z:W depth=1',
    ]);
  });

  test('posInSet/setSize stay consistent with the visible projection', () => {
    const controller = makeFlatController();
    // The flattened Income:Sales row occupies Income's sibling slot.
    const flattened = controller.getRow('Income:Sales');
    expect(flattened?.posInSet).toBe(3);
    expect(flattened?.setSize).toBe(4);
    // Its child keeps its own (unchanged) sibling arithmetic.
    const child = controller.getRow('Income:Sales:Consulting');
    expect(child?.depth).toBe(1);
    expect(child?.posInSet).toBe(1);
    expect(child?.setSize).toBe(1);
  });

  test('flattened rows show the deepest group balance', () => {
    const controller = makeFlatController();
    // Income:Sales rolled MYR balance: −1,500.00 (from the consulting sale).
    expect(controller.getRow('Income:Sales')?.balance).toBe(-150_000);
  });

  test('expansion toggles the deepest group via its canonical path', () => {
    const controller = makeFlatController();
    controller.setExpanded('Income:Sales', false);
    expect(controller.getRow('Income:Sales')?.expanded).toBe(false);
    expect(controller.getPathIndex('Income:Sales:Consulting')).toBe(-1);
    expect(controller.getVisibleCount()).toBe(11);
    controller.setExpanded('Income:Sales', true);
    expect(controller.getVisibleCount()).toBe(12);
  });

  test('selection and focus keep canonical paths; hidden mid-chain paths have no row', () => {
    const controller = makeFlatController();
    controller.selectPath('Income:Sales');
    expect(controller.getSelectedPaths()).toEqual(['Income:Sales']);
    expect(controller.getRow('Income:Sales')?.selected).toBe(true);
    // The chain head has no row of its own under flattening.
    expect(controller.getPathIndex('Income')).toBe(-1);
    expect(controller.getVisibleParentPath('Income:Sales:Consulting')).toBe(
      'Income:Sales'
    );
  });

  test('setFlattenEmptyGroups toggles at runtime with a change event', () => {
    const controller = new AccountTreeController({
      accounts: CHART_ACCOUNTS,
    });
    expect(controller.getVisibleCount()).toBe(14);

    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));

    controller.setFlattenEmptyGroups(true);
    expect(changes.length).toBe(1);
    expect(changes[0].expansionChanged).toBe(true);
    expect(controller.getVisibleCount()).toBe(12);

    controller.setFlattenEmptyGroups(true); // No-op: no event.
    expect(changes.length).toBe(1);

    controller.setFlattenEmptyGroups(false);
    expect(controller.getVisibleCount()).toBe(14);
    // Projection-only: canonical topology and expansion state untouched.
    expect(controller.isExpanded('Income')).toBe(true);
    expect(controller.getPathIndex('Income')).toBe(8);
  });

  test('flattened labels render joined segments with punctuation separators', () => {
    const controller = makeFlatController();
    const row = controller.getRow('Income:Sales');
    if (row == null) {
      throw new Error('flattened row missing');
    }
    const html = renderAccountRowHTML(row, 8, { currency: 'MYR' });
    expect(html).toContain('data-flattened-row="true"');
    expect(html).toContain(
      '<span data-name data-flattened="true">' +
        '<span data-name-segment>Income</span>' +
        '<span data-name-separator aria-hidden="true">:</span>' +
        '<span data-name-segment>Sales</span></span>'
    );
  });

  test('collapsed roll-up status lands on the flattened row', () => {
    const controller = makeFlatController();
    controller.setAccountStatus([
      { path: 'Income:Sales:Consulting', status: 'flagged', count: 2 },
    ]);
    controller.setExpanded('Income:Sales', false);
    const row = controller.getRow('Income:Sales');
    expect(row?.status).toBe('flagged');
    expect(row?.statusCount).toBe(2);
  });
});
