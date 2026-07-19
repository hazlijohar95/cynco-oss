import type { MinorUnits, RegisterRowData } from '../types';
import { areEntriesEqual } from './areEntriesEqual';

// Structural equality for register row arrays so LedgerView's incremental
// setSections can honestly decide "unchanged section — keep the DOM" versus
// "data changed — update the Register in place". Value comparison (not
// reference) because immutable stores hand out fresh arrays per snapshot;
// the reference fast paths keep the common no-change diff O(1) per row.
export function areRegisterRowArraysEqual(
  a: readonly RegisterRowData[],
  b: readonly RegisterRowData[]
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) {
      continue;
    }
    if (
      left.posting.account !== right.posting.account ||
      left.posting.amount !== right.posting.amount ||
      left.posting.currency !== right.posting.currency ||
      !areEntriesEqual(left.entry, right.entry) ||
      !areBalancesEqual(left.runningBalance, right.runningBalance)
    ) {
      return false;
    }
  }
  return true;
}

// Running balances compare per currency; integer minor units make this an
// exact comparison, never an epsilon.
function areBalancesEqual(
  a: ReadonlyMap<string, MinorUnits>,
  b: ReadonlyMap<string, MinorUnits>
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [currency, amount] of a) {
    if (b.get(currency) !== amount) return false;
  }
  return true;
}
