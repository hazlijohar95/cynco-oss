import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountTreeChange, AccountTreeRowData } from '../src/types';
import { CHART_ACCOUNTS } from './domHarness';

// Compact status projection over the current window: 'path status×count'.
function statusProjection(controller: AccountTreeController): string[] {
  const rows = controller.getRows(0, controller.getVisibleCount());
  return rows
    .filter((row: AccountTreeRowData) => row.status != null)
    .map((row) => `${row.path} ${row.status}\u00d7${row.statusCount}`);
}

describe('setAccountStatus', () => {
  test('own status shows on the decorated rows themselves', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
      { path: 'Liabilities:Current:AP', status: 'flagged' },
    ]);
    expect(statusProjection(controller)).toEqual([
      'Assets:Current:Cash-Maybank unreconciled\u00d73',
      'Liabilities:Current:AP flagged\u00d71',
    ]);
  });

  test('collapsed ancestors inherit the roll-up (git-status propagation)', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
    ]);

    // Expanded ancestors stay quiet — the decorated row is on screen.
    expect(statusProjection(controller)).toEqual([
      'Assets:Current:Cash-Maybank unreconciled\u00d73',
    ]);

    controller.setExpanded('Assets:Current', false);
    expect(statusProjection(controller)).toEqual([
      'Assets:Current unreconciled\u00d73',
    ]);

    controller.setExpanded('Assets', false);
    expect(statusProjection(controller)).toEqual([
      'Assets unreconciled\u00d73',
    ]);
  });

  test('roll-up sums counts and the highest severity wins', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setAccountStatus([
      { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
      { path: 'Assets:Current:Cash-CIMB', status: 'flagged', count: 2 },
      { path: 'Assets:Fixed:Equipment', status: 'pending' },
    ]);
    controller.setExpanded('Assets', false);
    expect(statusProjection(controller)).toEqual(['Assets flagged\u00d76']);
  });

  test('replaces prior decorations wholesale and fires statusChanged', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setAccountStatus([{ path: 'Expenses:Rent', status: 'pending' }]);
    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));

    controller.setAccountStatus([]);
    expect(changes.length).toBe(1);
    expect(changes[0].statusChanged).toBe(true);
    expect(changes[0].expansionChanged).toBe(false);
    expect(statusProjection(controller)).toEqual([]);
  });

  test('invalid paths are skipped silently', () => {
    const controller = new AccountTreeController({ accounts: CHART_ACCOUNTS });
    controller.setAccountStatus([
      { path: ':bad:path:', status: 'flagged' },
      { path: 'Expenses:Rent', status: 'pending' },
    ]);
    expect(statusProjection(controller)).toEqual([
      'Expenses:Rent pending\u00d71',
    ]);
  });
});
