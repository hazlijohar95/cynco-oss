// Drop collision strategies at the model layer: planMovePaths breakdowns
// (reject / skip / replace), applyMovePlan's replace-then-move rebuild, and
// the back-compat guarantees for getMovePlan / movePaths (both keep their
// original skip semantics and shapes).

import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountMove, AccountTreeChange, LedgerEntry } from '../src/types';

// Collision-rich chart: A:X:N collides into A:Y (A:Y:N exists, with a
// subtree and its own postings); A:X:Clean moves anywhere freely.
const COLLISION_ACCOUNTS = [
  'A:X:N',
  'A:X:Clean',
  'A:Y:N:Deep',
  'Equity:Opening',
] as const;

function makeEntries(): LedgerEntry[] {
  const entry = (id: string, account: string, amount: number): LedgerEntry => ({
    id,
    date: '2026-07-01',
    flag: 'cleared',
    payee: null,
    narration: id,
    tags: [],
    links: [],
    postings: [
      { account, amount, currency: 'MYR' },
      { account: 'Equity:Opening', amount: -amount, currency: 'MYR' },
    ],
  });
  return [entry('e-xn', 'A:X:N', 10_000), entry('e-deep', 'A:Y:N:Deep', 5_000)];
}

function makeController(): AccountTreeController {
  return new AccountTreeController({
    accounts: [...COLLISION_ACCOUNTS],
    entries: makeEntries(),
  });
}

describe('planMovePaths strategies', () => {
  test("'reject' (default) empties moves and reports the whole batch on any collision", () => {
    const controller = makeController();
    const plan = controller.planMovePaths(['A:X:N', 'A:X:Clean'], 'A:Y');
    expect(plan.moves).toEqual([]);
    expect(plan.replaced).toEqual([]);
    // Every candidate — clean and colliding — lands in skipped so error
    // reporters can show the full attempted batch.
    expect(plan.skipped).toEqual([
      { from: 'A:X:Clean', to: 'A:Y:Clean' },
      { from: 'A:X:N', to: 'A:Y:N' },
    ]);
  });

  test("'reject' without collisions plans normally", () => {
    const controller = makeController();
    const plan = controller.planMovePaths(['A:X:Clean'], 'A:Y', 'reject');
    expect(plan.moves).toEqual([{ from: 'A:X:Clean', to: 'A:Y:Clean' }]);
    expect(plan.skipped).toEqual([]);
    expect(plan.replaced).toEqual([]);
  });

  test("'skip' drops colliding candidates and keeps the rest", () => {
    const controller = makeController();
    const plan = controller.planMovePaths(
      ['A:X:N', 'A:X:Clean'],
      'A:Y',
      'skip'
    );
    expect(plan.moves).toEqual([{ from: 'A:X:Clean', to: 'A:Y:Clean' }]);
    expect(plan.skipped).toEqual([{ from: 'A:X:N', to: 'A:Y:N' }]);
    expect(plan.replaced).toEqual([]);
  });

  test("'skip' with every candidate colliding plans a no-op", () => {
    const controller = makeController();
    const plan = controller.planMovePaths(['A:X:N'], 'A:Y', 'skip');
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual([{ from: 'A:X:N', to: 'A:Y:N' }]);
  });

  test("'replace' claims the existing destination subtree and proceeds", () => {
    const controller = makeController();
    const plan = controller.planMovePaths(
      ['A:X:N', 'A:X:Clean'],
      'A:Y',
      'replace'
    );
    expect(plan.moves).toEqual([
      { from: 'A:X:N', to: 'A:Y:N' },
      { from: 'A:X:Clean', to: 'A:Y:Clean' },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.replaced).toEqual(['A:Y:N']);
  });

  test('within-batch collisions keep first-claim-wins under every strategy', () => {
    const controller = new AccountTreeController({
      accounts: ['P:N', 'Q:N', 'R:Z'],
    });
    for (const strategy of ['skip', 'replace'] as const) {
      const plan = controller.planMovePaths(['P:N', 'Q:N'], 'R', strategy);
      expect(plan.moves).toEqual([{ from: 'P:N', to: 'R:N' }]);
      expect(plan.skipped).toEqual([{ from: 'Q:N', to: 'R:N' }]);
      expect(plan.replaced).toEqual([]);
    }
    // Under reject the within-batch collision blocks the whole drop too.
    const rejected = controller.planMovePaths(['P:N', 'Q:N'], 'R', 'reject');
    expect(rejected.moves).toEqual([]);
    expect(rejected.skipped).toEqual([
      { from: 'P:N', to: 'R:N' },
      { from: 'Q:N', to: 'R:N' },
    ]);
  });

  test("a source inside a replaced subtree is skipped — it won't exist", () => {
    const controller = makeController();
    // A:X:N replaces A:Y:N; A:Y:N:Deep is dragged in the same batch but its
    // whole subtree is being removed by that replacement.
    const plan = controller.planMovePaths(
      ['A:X:N', 'A:Y:N:Deep'],
      'A:Y',
      'replace'
    );
    expect(plan.moves).toEqual([{ from: 'A:X:N', to: 'A:Y:N' }]);
    expect(plan.skipped).toEqual([{ from: 'A:Y:N:Deep', to: 'A:Y:Deep' }]);
    expect(plan.replaced).toEqual(['A:Y:N']);
  });

  test('getMovePlan keeps its original skip-shaped back-compat surface', () => {
    const controller = makeController();
    expect(controller.getMovePlan(['A:X:N', 'A:X:Clean'], 'A:Y')).toEqual([
      { from: 'A:X:Clean', to: 'A:Y:Clean' },
    ]);
  });
});

describe('applyMovePlan', () => {
  test("'replace' removes the target subtree, drops its entries, and moves in one change event", () => {
    const controller = makeController();
    controller.selectPath('A:Y:N:Deep');
    controller.setExpanded('A:Y:N', false);
    controller.setAccountStatus([{ path: 'A:Y:N:Deep', status: 'flagged' }]);

    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));
    const moveBatches: Array<readonly AccountMove[]> = [];
    controller.onMove((moves) => moveBatches.push(moves));

    const plan = controller.planMovePaths(['A:X:N'], 'A:Y', 'replace');
    const applied = controller.applyMovePlan(plan);
    expect(applied.replaced).toEqual(['A:Y:N']);

    // Exactly one change event and one onMove batch for the whole
    // remove-then-move operation.
    expect(changes.length).toBe(1);
    expect(moveBatches).toEqual([[{ from: 'A:X:N', to: 'A:Y:N' }]]);

    // The replaced subtree is gone; the moved account took its path.
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(false);
    expect(controller.hasAccount('A:Y:N')).toBe(true);
    expect(controller.getRow('A:Y:N')?.kind).toBe('leaf');
    expect(controller.hasAccount('A:X:N')).toBe(false);

    // The replaced subtree's ENTRIES were dropped from the remapped entry
    // set: only the moved account's posting remains, so A:Y rolls exactly
    // the moved 100.00 and Equity mirrors only the surviving entry.
    expect(controller.getRow('A:Y')?.balance).toBe(10_000);
    expect(controller.getRow('A:Y:N')?.balance).toBe(10_000);
    expect(controller.getRow('Equity')?.balance).toBe(-10_000);

    // Selection/status on removed paths were dropped, not remapped; the
    // collapsed state of the removed group did not leak onto the new leaf.
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getOwnStatus('A:Y:N')).toBeNull();
  });

  test("'replace' drops focus and search matches on removed paths", () => {
    const controller = makeController();
    controller.setFocusedPath('A:Y:N:Deep');
    controller.beginSearch('Deep');
    expect(controller.getSearchMatchState()).toEqual({ index: 1, total: 1 });

    controller.applyMovePlan(
      controller.planMovePaths(['A:X:N'], 'A:Y', 'replace')
    );
    expect(controller.getFocusedPath()).toBeNull();
    expect(controller.getSearchMatchState()).toEqual({ index: 0, total: 0 });
  });

  test('an empty plan applies nothing and fires nothing', () => {
    const controller = makeController();
    let events = 0;
    controller.onChange(() => (events += 1));
    controller.onMove(() => (events += 1));
    const plan = controller.planMovePaths(['A:X:N'], 'A:Y', 'skip');
    expect(controller.applyMovePlan(plan)).toBe(plan);
    expect(events).toBe(0);
    expect(controller.hasAccount('A:X:N')).toBe(true);
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(true);
  });

  test('movePaths keeps its original behavior and return shape', () => {
    const controller = makeController();
    const moves = controller.movePaths(['A:X:N', 'A:X:Clean'], 'A:Y');
    // Skip semantics, exactly as before: the colliding source stays put.
    expect(moves).toEqual([{ from: 'A:X:Clean', to: 'A:Y:Clean' }]);
    expect(controller.hasAccount('A:X:N')).toBe(true);
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(true);
  });
});
