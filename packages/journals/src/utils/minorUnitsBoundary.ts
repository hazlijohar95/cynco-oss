import type { LedgerEntry, MinorUnits, RegisterRowData } from '../types';

/**
 * True when `value` is usable as an exact integer minor-unit amount.
 * `MinorUnits` is a bare `number` alias for ergonomics, so nothing stops a
 * host passing major units (`12.5` for RM 12.50) — which the renderers then
 * degrade to `0.12`-ish output (fractional input truncates; see
 * formatMinorUnits). Hosts can use this predicate to validate their own
 * data before it enters a component.
 */
export function isValidMinorUnits(value: MinorUnits): boolean {
  return Number.isSafeInteger(value);
}

// Once-per-context memory for the boundary warnings below, bounded two ways:
// each context warns at most once (re-ingesting the same bad dataset stays
// silent), and the set itself is capped so dynamically generated context
// keys can never grow memory. Module-level rather than per-instance so a
// host mounting many components over the same bad data gets one actionable
// message instead of a spam wall.
const MAX_WARNED_CONTEXTS = 32;
const warnedContexts = new Set<string>();

// The repo has no dev/prod gating idiom (no NODE_ENV or import.meta.env
// branches anywhere in the packages), so these checks run unconditionally.
// They stay cheap instead: they run only at data-ingestion boundaries that
// are already O(new data), the scan is capped at this many amounts (bad
// boundary data is systematic — a host converting units wrong converts
// every row wrong, so the head of the array is as good as the whole), and
// an already-warned context short-circuits before scanning at all.
const BOUNDARY_SCAN_LIMIT = 400;

/**
 * Reports one non-integer amount for `context`, then goes silent for that
 * context. console.error, never throw: the rendering philosophy is
 * degrade-visibly-never-invent (a bad balance renders as an empty cell, a
 * fractional amount truncates), so the warning is a diagnostic side channel
 * that must never alter rendered output or take the component down.
 *
 * @internal Exposed for the package's own ingestion boundaries and tests.
 */
export function warnInvalidMinorUnits(context: string, value: number): void {
  if (
    warnedContexts.has(context) ||
    warnedContexts.size >= MAX_WARNED_CONTEXTS
  ) {
    return;
  }
  warnedContexts.add(context);
  console.error(
    `[@cynco/journals] ${context}: amounts must be integer minor units — ` +
      `got ${value}; multiply by the currency's minor-unit factor, ` +
      `e.g. RM 12.50 → 1250.`
  );
}

/** Clears the once-per-context memory. @internal Test hook only. */
export function resetInvalidMinorUnitsWarnings(): void {
  warnedContexts.clear();
}

/**
 * Boundary check for register data: posting amounts and running balances.
 * Called where rows enter a Register (setRows and the hydrate adoptions),
 * never from windowing/render paths.
 *
 * @internal
 */
export function warnIfInvalidRegisterRows(
  context: string,
  rows: readonly RegisterRowData[]
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  let scanned = 0;
  for (const row of rows) {
    if (scanned >= BOUNDARY_SCAN_LIMIT) {
      return;
    }
    scanned += 1;
    if (!isValidMinorUnits(row.posting.amount)) {
      warnInvalidMinorUnits(context, row.posting.amount);
      return;
    }
    for (const balance of row.runningBalance.values()) {
      if (!isValidMinorUnits(balance)) {
        warnInvalidMinorUnits(context, balance);
        return;
      }
    }
  }
}

/**
 * Boundary check for a single entry's posting amounts (entries carry a
 * handful of postings, so no scan cap is needed). Called where an entry
 * enters a component, never from render paths.
 *
 * @internal
 */
export function warnIfInvalidEntryAmounts(
  context: string,
  entry: LedgerEntry
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  for (const posting of entry.postings) {
    if (!isValidMinorUnits(posting.amount)) {
      warnInvalidMinorUnits(context, posting.amount);
      return;
    }
  }
}
