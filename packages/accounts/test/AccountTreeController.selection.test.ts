import { describe, expect, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import type { AccountTreeChange } from '../src/types';
import { CHART_ACCOUNTS } from './domHarness';

function makeController(): AccountTreeController {
  return new AccountTreeController({ accounts: CHART_ACCOUNTS });
}

describe('selectPath', () => {
  test('plain select replaces the selection and moves focus', () => {
    const controller = makeController();
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.selectPath('Expenses:Rent');
    expect(controller.getSelectedPaths()).toEqual(['Expenses:Rent']);
    expect(controller.getFocusedPath()).toBe('Expenses:Rent');
  });

  test('additive select toggles paths in and out', () => {
    const controller = makeController();
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.selectPath('Expenses:Rent', { additive: true });
    expect(controller.getSelectedPaths()).toEqual([
      'Assets:Current:Cash-CIMB',
      'Expenses:Rent',
    ]);
    controller.selectPath('Assets:Current:Cash-CIMB', { additive: true });
    expect(controller.getSelectedPaths()).toEqual(['Expenses:Rent']);
  });

  test('range select spans the visible order from the anchor', () => {
    const controller = makeController();
    controller.selectPath('Assets:Current:Cash-CIMB'); // index 2 (anchor)
    controller.selectPath('Assets:Fixed:Equipment', { range: true }); // index 5
    expect(controller.getSelectedPaths()).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Assets:Fixed',
      'Assets:Fixed:Equipment',
    ]);
    // Re-pivot around the same anchor: a shorter shift-click shrinks the span.
    controller.selectPath('Assets:Current:Cash-Maybank', { range: true });
    expect(controller.getSelectedPaths()).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
    ]);
  });

  test('additive range unions the span into the existing selection', () => {
    const controller = makeController();
    controller.selectPath('Expenses:Rent');
    controller.selectPath('Assets:Current:Cash-CIMB', { additive: true });
    controller.selectPath('Assets:Current:Cash-Maybank', {
      additive: true,
      range: true,
    });
    expect(controller.getSelectedPaths()).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Expenses:Rent',
    ]);
  });

  test('re-selecting the sole selected path fires no change event', () => {
    const controller = makeController();
    controller.selectPath('Expenses:Rent');
    const changes: AccountTreeChange[] = [];
    controller.onChange((change) => changes.push(change));
    controller.selectPath('Expenses:Rent');
    expect(changes.length).toBe(0);
  });

  test('unknown paths are ignored', () => {
    const controller = makeController();
    controller.selectPath('Equity:Nope');
    expect(controller.getSelectedPaths()).toEqual([]);
  });
});

describe('focus movement', () => {
  test('arrow movement walks the visible projection', () => {
    const controller = makeController();
    expect(controller.moveFocus(1)).toBe('Assets');
    expect(controller.moveFocus(1)).toBe('Assets:Current');
    expect(controller.moveFocus(1)).toBe('Assets:Current:Cash-CIMB');
    expect(controller.moveFocus(-1)).toBe('Assets:Current');
    // Clamped at the top.
    controller.focusIndex(0);
    expect(controller.moveFocus(-1)).toBe('Assets');
  });

  test('collapsed subtrees are skipped during traversal', () => {
    const controller = makeController();
    controller.setExpanded('Assets:Current', false);
    controller.setFocusedPath('Assets:Current');
    expect(controller.moveFocus(1)).toBe('Assets:Fixed');
    expect(controller.moveFocus(-1)).toBe('Assets:Current');
  });

  test('focus survives being hidden by a collapse and movement recovers', () => {
    const controller = makeController();
    controller.setFocusedPath('Assets:Current:Cash-CIMB');
    controller.setExpanded('Assets:Current', false);
    // The focused path is now hidden; the next move restarts from the edge.
    expect(controller.moveFocus(1)).toBe('Assets');
  });

  test('type-ahead focuses the next row starting with the letter, cyclically', () => {
    const controller = makeController();
    expect(controller.focusByTypeAhead('e')).toBe('Assets:Fixed:Equipment');
    expect(controller.focusByTypeAhead('e')).toBe('Expenses');
    expect(controller.focusByTypeAhead('e')).toBe('Assets:Fixed:Equipment');
    expect(controller.focusByTypeAhead('x')).toBeNull();
  });
});
