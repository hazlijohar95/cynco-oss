import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountTreeChange } from '../src/types';
import { CHART_ACCOUNTS, makeChartEntries } from './domHarness';

function makeController(): AccountTreeController {
  return new AccountTreeController({
    accounts: CHART_ACCOUNTS,
    entries: makeChartEntries(),
  });
}

describe('commitRename validation', () => {
  test('unknown paths fail', () => {
    const controller = makeController();
    expect(controller.commitRename('Equity:Nope', 'X')).toEqual({
      ok: false,
      reason: 'unknown-path',
    });
  });

  test('empty and whitespace-only names fail', () => {
    const controller = makeController();
    expect(controller.commitRename('Expenses:Rent', '')).toEqual({
      ok: false,
      reason: 'invalid-name',
    });
    expect(controller.commitRename('Expenses:Rent', '   ')).toEqual({
      ok: false,
      reason: 'invalid-name',
    });
  });

  test('names containing the path separator fail', () => {
    const controller = makeController();
    expect(controller.commitRename('Expenses:Rent', 'Rent:2026')).toEqual({
      ok: false,
      reason: 'invalid-name',
    });
  });

  test('sibling collisions fail', () => {
    const controller = makeController();
    expect(
      controller.commitRename('Assets:Current:Cash-CIMB', 'Cash-Maybank')
    ).toEqual({ ok: false, reason: 'collision' });
    // Nothing changed on failure.
    expect(controller.hasAccount('Assets:Current:Cash-CIMB')).toBe(true);
  });

  test('failures keep an open rename session alive', () => {
    const controller = makeController();
    controller.beginRename('Expenses:Rent');
    controller.commitRename('Expenses:Rent', '');
    expect(controller.getRenamingPath()).toBe('Expenses:Rent');
  });
});

describe('commitRename remap', () => {
  test('leaf rename remaps the path and fires onRename', () => {
    const controller = makeController();
    const renames: Array<[string, string]> = [];
    controller.onRename((oldPath, newPath) => renames.push([oldPath, newPath]));

    const result = controller.commitRename(
      'Assets:Current:Cash-CIMB',
      'Cash-Wise'
    );
    expect(result).toEqual({ ok: true, newPath: 'Assets:Current:Cash-Wise' });
    expect(controller.hasAccount('Assets:Current:Cash-CIMB')).toBe(false);
    expect(controller.hasAccount('Assets:Current:Cash-Wise')).toBe(true);
    expect(renames).toEqual([
      ['Assets:Current:Cash-CIMB', 'Assets:Current:Cash-Wise'],
    ]);
  });

  test('group rename carries descendants, balances, expansion, selection, and focus', () => {
    const controller = makeController();
    controller.setExpanded('Assets:Current', false);
    controller.selectPath('Assets:Current:Cash-Maybank');
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
    ]);

    const result = controller.commitRename('Assets:Current', 'Ops');
    expect(result).toEqual({ ok: true, newPath: 'Assets:Ops' });

    // Descendants remapped; old subtree gone.
    expect(controller.hasAccount('Assets:Ops:Cash-Maybank')).toBe(true);
    expect(controller.hasAccount('Assets:Current')).toBe(false);
    // Balances rebuilt from remapped postings: 1,500.00 − 800.00 = 700.00.
    expect(controller.getRow('Assets:Ops')?.balance).toBe(70_000);
    // Expansion state followed the remap (still collapsed).
    expect(controller.isExpanded('Assets:Ops')).toBe(false);
    // Selection and focus followed.
    expect(controller.getSelectedPaths()).toEqual(['Assets:Ops:Cash-Maybank']);
    expect(controller.getFocusedPath()).toBe('Assets:Ops:Cash-Maybank');
    // Status decorations followed.
    expect(controller.getOwnStatus('Assets:Ops:Cash-Maybank')?.count).toBe(3);
    expect(controller.getRolledStatus('Assets:Ops')?.status).toBe(
      'unreconciled'
    );
  });

  test('committing the unchanged name is a successful no-op', () => {
    const controller = makeController();
    const renames: Array<[string, string]> = [];
    controller.onRename((oldPath, newPath) => renames.push([oldPath, newPath]));
    controller.beginRename('Expenses:Rent');
    const result = controller.commitRename('Expenses:Rent', 'Rent');
    expect(result).toEqual({ ok: true, newPath: 'Expenses:Rent' });
    expect(renames).toEqual([]);
    expect(controller.getRenamingPath()).toBeNull();
  });

  test('a committed rename ends the session with one honest change event', () => {
    const controller = makeController();
    controller.beginRename('Expenses:Rent');
    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));

    controller.commitRename('Expenses:Rent', 'Office-Rent');
    expect(changes.length).toBe(1);
    expect(changes[0].renameChanged).toBe(true);
    expect(changes[0].expansionChanged).toBe(true);
    expect(controller.getRenamingPath()).toBeNull();
  });
});

describe('rename session state', () => {
  test('beginRename seeds the draft from the leaf name', () => {
    const controller = makeController();
    expect(controller.beginRename('Assets:Current:Cash-CIMB')).toBe(true);
    expect(controller.getRenamingPath()).toBe('Assets:Current:Cash-CIMB');
    expect(controller.getRenameDraft()).toBe('Cash-CIMB');
  });

  test('beginRename rejects unknown paths', () => {
    const controller = makeController();
    expect(controller.beginRename('Equity:Nope')).toBe(false);
    expect(controller.getRenamingPath()).toBeNull();
  });

  test('the draft survives updates and cancelRename clears the session', () => {
    const controller = makeController();
    controller.beginRename('Expenses:Rent');
    controller.setRenameDraft('Office');
    expect(controller.getRenameDraft()).toBe('Office');

    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));
    controller.cancelRename();
    expect(controller.getRenamingPath()).toBeNull();
    expect(changes.length).toBe(1);
    expect(changes[0].renameChanged).toBe(true);
    // The account was never touched.
    expect(controller.hasAccount('Expenses:Rent')).toBe(true);
  });
});
