import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountMove } from '../src/types';
import { CHART_ACCOUNTS, makeChartEntries } from './domHarness';

function makeController(): AccountTreeController {
  return new AccountTreeController({
    accounts: CHART_ACCOUNTS,
    entries: makeChartEntries(),
  });
}

describe('getMovePlan guard matrix', () => {
  test('dropping on self is rejected', () => {
    const controller = makeController();
    expect(
      controller.getMovePlan(['Assets:Current'], 'Assets:Current')
    ).toEqual([]);
  });

  test('dropping into an own descendant is rejected', () => {
    const controller = makeController();
    expect(controller.getMovePlan(['Assets'], 'Assets:Current')).toEqual([]);
  });

  test('dropping onto the current parent is a no-op', () => {
    const controller = makeController();
    expect(
      controller.getMovePlan(['Assets:Current:Cash-CIMB'], 'Assets:Current')
    ).toEqual([]);
  });

  test('leaf rows and unknown paths are not targets', () => {
    const controller = makeController();
    expect(
      controller.getMovePlan(['Assets:Current:Cash-CIMB'], 'Expenses:Rent')
    ).toEqual([]);
    expect(
      controller.getMovePlan(['Assets:Current:Cash-CIMB'], 'Equity')
    ).toEqual([]);
  });

  test('leaf-name collisions at the target are skipped', () => {
    const controller = new AccountTreeController({
      accounts: ['A:X:N', 'A:Y:N'],
    });
    expect(controller.getMovePlan(['A:X:N'], 'A:Y')).toEqual([]);
  });

  test('within-batch collisions keep the first source only', () => {
    const controller = new AccountTreeController({
      accounts: ['A:N', 'B:N', 'C:Z'],
    });
    expect(controller.getMovePlan(['A:N', 'B:N'], 'C')).toEqual([
      { from: 'A:N', to: 'C:N' },
    ]);
  });

  test('unknown sources are skipped, valid ones survive', () => {
    const controller = makeController();
    expect(
      controller.getMovePlan(
        ['Equity:Nope', 'Assets:Current:Cash-CIMB'],
        'Assets:Fixed'
      )
    ).toEqual([
      { from: 'Assets:Current:Cash-CIMB', to: 'Assets:Fixed:Cash-CIMB' },
    ]);
  });

  test('multi-select batches move each subtree once', () => {
    const controller = makeController();
    // Cash-CIMB rides along with its dragged ancestor Assets:Current.
    expect(
      controller.getMovePlan(
        ['Assets:Current', 'Assets:Current:Cash-CIMB', 'Expenses:Rent'],
        'Liabilities:Current'
      )
    ).toEqual([
      { from: 'Assets:Current', to: 'Liabilities:Current:Current' },
      { from: 'Expenses:Rent', to: 'Liabilities:Current:Rent' },
    ]);
  });
});

describe('movePaths', () => {
  test('re-parents a leaf and recomputes rolled balances', () => {
    const controller = makeController();
    const moves = controller.movePaths(
      ['Assets:Current:Cash-Maybank'],
      'Assets:Fixed'
    );
    expect(moves).toEqual([
      { from: 'Assets:Current:Cash-Maybank', to: 'Assets:Fixed:Cash-Maybank' },
    ]);
    // Balances re-rolled from remapped postings: the 700.00 moved subtrees.
    expect(controller.getRow('Assets:Fixed')?.balance).toBe(70_000);
    expect(controller.getRow('Assets:Current')?.balance).toBeNull();
    expect(controller.getRow('Assets')?.balance).toBe(70_000);
  });

  test('moves whole subtrees with expansion, selection, and status following', () => {
    const controller = makeController();
    controller.setExpanded('Assets:Current', false);
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-CIMB', status: 'pending' },
    ]);

    const moves = controller.movePaths(
      ['Assets:Current'],
      'Liabilities:Current'
    );
    expect(moves).toEqual([
      { from: 'Assets:Current', to: 'Liabilities:Current:Current' },
    ]);
    expect(
      controller.hasAccount('Liabilities:Current:Current:Cash-Maybank')
    ).toBe(true);
    expect(controller.hasAccount('Assets:Current')).toBe(false);
    expect(controller.isExpanded('Liabilities:Current:Current')).toBe(false);
    expect(controller.getSelectedPaths()).toEqual([
      'Liabilities:Current:Current:Cash-CIMB',
    ]);
    expect(
      controller.getOwnStatus('Liabilities:Current:Current:Cash-CIMB')?.status
    ).toBe('pending');
    // The moved cash balance now rolls under Liabilities.
    expect(controller.getRow('Liabilities')?.balance).toBe(70_000);
  });

  test('fires onMove with the applied moves; a fully-guarded drop stays silent', () => {
    const controller = makeController();
    const batches: Array<readonly AccountMove[]> = [];
    controller.onMove((moves) => batches.push(moves));

    controller.movePaths(['Assets:Current'], 'Assets:Current'); // Guarded.
    expect(batches.length).toBe(0);

    controller.movePaths(['Expenses:Rent'], 'Assets:Fixed');
    expect(batches).toEqual([
      [{ from: 'Expenses:Rent', to: 'Assets:Fixed:Rent' }],
    ]);
  });

  test('a group emptied by a move disappears when it was only implied', () => {
    const controller = new AccountTreeController({
      entries: makeChartEntries(),
    });
    // Expenses only exists because Expenses:Rent implies it.
    const moves = controller.movePaths(['Expenses:Rent'], 'Assets:Current');
    expect(moves).toEqual([
      { from: 'Expenses:Rent', to: 'Assets:Current:Rent' },
    ]);
    expect(controller.hasAccount('Expenses')).toBe(false);
  });
});
