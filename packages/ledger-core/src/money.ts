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
 * Negates a minor-unit amount without ever producing IEEE negative zero
 * (`-0` survives `toEqual` checks, `Object.is`, and division-based math, so
 * letting it leak out of a derivation invites subtle downstream bugs).
 * Statement derivations use this for every presentation sign flip.
 */
export function negateMinorUnits(n: MinorUnits): MinorUnits {
  return n === 0 ? 0 : -n;
}

/**
 * True when a value is a minor-unit amount that has left the exactly-
 * representable integer range. Individual postings are validated on ingest,
 * but an *aggregate* of many individually-safe postings can still cross
 * `Number.MAX_SAFE_INTEGER`, at which point plain `+` silently loses integer
 * precision. Callers accumulating sums use this to surface the overflow
 * (flag, never silently repair) instead of trusting a poisoned total.
 */
export function isMinorUnitsOverflow(n: number): boolean {
  return !Number.isSafeInteger(n);
}

/**
 * Sums posting amounts grouped by currency code. Postings with non-integer
 * or unsafe amounts are skipped (graceful degradation: this runs over
 * user-authored ledger data), so the returned totals are always exact
 * integers unless the *aggregate* itself overflows 2^53. An empty posting
 * list yields an empty map.
 *
 * When any per-currency running total leaves the safe-integer range the
 * currency is recorded in `overflowCurrencies` on the returned object; the
 * total for that currency is no longer exact and must be treated as flagged,
 * not authoritative. Callers that only need exact totals can ignore the flag
 * set — it is empty in every non-pathological ledger.
 */
export function sumPostingsByCurrency(
  postings: readonly Posting[]
): Map<string, MinorUnits> {
  return sumPostingsByCurrencyChecked(postings).totals;
}

export interface CheckedCurrencyTotals {
  totals: Map<string, MinorUnits>;
  /** Currencies whose running total crossed 2^53 during accumulation. */
  overflowCurrencies: Set<string>;
}

/**
 * Overflow-aware variant of `sumPostingsByCurrency`. Detects when a running
 * per-currency total leaves the safe-integer range so aggregate overflow is
 * surfaced rather than silently swallowed by float precision loss.
 */
export function sumPostingsByCurrencyChecked(
  postings: readonly Posting[]
): CheckedCurrencyTotals {
  const totals = new Map<string, MinorUnits>();
  const overflowCurrencies = new Set<string>();
  for (const posting of postings) {
    if (!Number.isSafeInteger(posting.amount)) {
      continue;
    }
    const current = totals.get(posting.currency);
    const next = current == null ? posting.amount : current + posting.amount;
    totals.set(posting.currency, next);
    if (isMinorUnitsOverflow(next)) {
      overflowCurrencies.add(posting.currency);
    }
  }
  return { totals, overflowCurrencies };
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
