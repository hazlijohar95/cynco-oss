// Integer minor-unit arithmetic. Amounts are integer sen/cents end to end —
// no floats ever touch monetary values — so equality checks are exact and
// per-currency zero-sum balancing is a plain integer comparison.

import type { LedgerEntry, MinorUnits, Posting } from './types';

/**
 * Guards the integer minor-unit invariant at programmer-error boundaries:
 * throws a `TypeError` when `n` is not an integer or falls outside the
 * exactly-representable range (`Number.MAX_SAFE_INTEGER`). This is the one
 * deliberate exception to the graceful-degradation rule — a float or an
 * overflowing amount reaching money math is a bug in the caller, not bad
 * user data, and silently continuing would poison every downstream balance.
 */
export function assertSafeMinorUnits(n: MinorUnits): void {
  if (!Number.isSafeInteger(n)) {
    throw new TypeError(
      `Expected integer minor units within Number.MAX_SAFE_INTEGER, got ${n}`
    );
  }
}

/**
 * Adds two minor-unit amounts, asserting both inputs and the result stay
 * safe integers. Use this instead of bare `+` wherever amounts from external
 * data meet, so overflow surfaces at the addition site rather than as a
 * subtly wrong balance later.
 */
export function addMinorUnits(a: MinorUnits, b: MinorUnits): MinorUnits {
  assertSafeMinorUnits(a);
  assertSafeMinorUnits(b);
  const sum = a + b;
  assertSafeMinorUnits(sum);
  return sum;
}

/**
 * Sums posting amounts grouped by currency code. Postings with non-integer
 * or unsafe amounts are skipped (graceful degradation: this runs over
 * user-authored ledger data), so the returned totals are always exact
 * integers. An empty posting list yields an empty map.
 */
export function sumPostingsByCurrency(
  postings: readonly Posting[]
): Map<string, MinorUnits> {
  const totals = new Map<string, MinorUnits>();
  for (const posting of postings) {
    if (!Number.isSafeInteger(posting.amount)) {
      continue;
    }
    const current = totals.get(posting.currency);
    totals.set(
      posting.currency,
      current == null ? posting.amount : current + posting.amount
    );
  }
  return totals;
}

/**
 * True when the entry's postings sum to exactly zero in every currency they
 * touch — the double-entry invariant. Entries with no postings are trivially
 * balanced. Entries containing non-integer amounts are reported unbalanced
 * (never silently repaired): the data layer surfaces bad input, renderers
 * decide how to flag it.
 */
export function isEntryBalanced(entry: LedgerEntry): boolean {
  for (const posting of entry.postings) {
    if (!Number.isSafeInteger(posting.amount)) {
      return false;
    }
  }
  for (const total of sumPostingsByCurrency(entry.postings).values()) {
    if (total !== 0) {
      return false;
    }
  }
  return true;
}
