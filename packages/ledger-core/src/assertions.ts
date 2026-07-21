// Balance assertions: declarative "this account held exactly this balance on
// this date" checks against an EntryStore. Assertions are how imported and
// migrated ledgers prove themselves — a statement import asserts the closing
// balance the bank printed, an opening-balance migration asserts day-one
// figures — and how drift is caught early instead of surfacing as a wrong
// financial statement months later.
//
// Checking is pure surfacing: a failed assertion reports the discrepancy and
// changes nothing. The store never books a plug to make an assertion pass,
// matching the suite-wide rule that imbalances are flagged, never repaired.

import type { EntryStore } from './EntryStore';
import type { MinorUnits } from './types';

/**
 * One declared balance fact: `account` is expected to hold exactly `amount`
 * in `currency` at the end of `date` (inclusive of that day's postings).
 */
export interface BalanceAssertion {
  /** Canonical colon-delimited account path. */
  account: string;
  /** ISO date `YYYY-MM-DD`; the assertion covers postings through this day. */
  date: string;
  /**
   * Expected balance in integer minor units, signed like every amount in
   * the suite (positive = debit balance, negative = credit balance).
   */
  amount: MinorUnits;
  /** Currency the assertion is scoped to; other currencies are not checked. */
  currency: string;
  /**
   * When true the assertion checks the rolled-up balance (own postings plus
   * every descendant account). Defaults to false: own postings only.
   */
  includeDescendants?: boolean;
}

/** Outcome of checking one {@link BalanceAssertion}. */
export interface BalanceAssertionResult {
  /** The assertion that was checked (shared reference, not a copy). */
  assertion: BalanceAssertion;
  /** The balance the store actually holds for (account, currency, date). */
  actual: MinorUnits;
  /**
   * `actual - assertion.amount`: zero when the assertion holds, positive
   * when the account holds more (toward debit) than asserted.
   */
  difference: MinorUnits;
  /** True only when the actual balance equals the asserted amount exactly. */
  ok: boolean;
}

/**
 * Checks every assertion against the store and reports each outcome in
 * input order. Degrades gracefully on bad assertion data: an invalid account
 * path checks against a zero balance (absence means zero, the store's
 * convention), and a non-integer expected amount can never equal an actual
 * integer balance so it reports `ok: false` — flagged, never repaired or
 * thrown over, because assertions frequently arrive from user-authored
 * import files.
 */
export function checkBalanceAssertions(
  store: EntryStore,
  assertions: readonly BalanceAssertion[]
): BalanceAssertionResult[] {
  const results: BalanceAssertionResult[] = [];
  for (const assertion of assertions) {
    const balances = store.getBalancesAsOf(assertion.account, assertion.date, {
      includeDescendants: assertion.includeDescendants === true,
    });
    const actual = balances.get(assertion.currency) ?? 0;
    const difference = actual - assertion.amount;
    results.push({
      assertion,
      actual,
      difference,
      ok: difference === 0,
    });
  }
  return results;
}
