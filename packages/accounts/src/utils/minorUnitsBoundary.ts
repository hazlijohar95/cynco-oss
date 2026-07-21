import type { LedgerEntry, MinorUnits } from '../types';

/**
 * True when `value` is usable as an exact integer minor-unit amount.
 * `MinorUnits` is a bare `number` alias for ergonomics, so nothing stops a
 * host passing major units (`12.5` for RM 12.50) — which the balance column
 * then degrades to `0.12`-ish output (fractional input truncates; see
 * formatMinorUnits). Hosts can use this predicate to validate their own
 * data before it enters the tree.
 */
export function isValidMinorUnits(value: MinorUnits): boolean {
  return Number.isSafeInteger(value);
}

// Once-per-context memory for the boundary warnings below, bounded two ways:
// each context warns at most once (re-ingesting the same bad dataset stays
// silent), and the set itself is capped so dynamically generated context
// keys can never grow memory. Module-level rather than per-instance so a
// host mounting many controllers over the same bad data gets one actionable
// message instead of a spam wall.
const MAX_WARNED_CONTEXTS = 32;
const warnedContexts = new Set<string>();

// The repo has no dev/prod gating idiom (no NODE_ENV or import.meta.env
// branches anywhere in the packages), so these checks run unconditionally.
// They stay cheap instead: they run only at data-ingestion boundaries that
// are already O(new data), the scan is capped at this many amounts (bad
// boundary data is systematic — a host converting units wrong converts
// every posting wrong, so the head of the data is as good as the whole),
// and an already-warned context short-circuits before scanning at all.
const BOUNDARY_SCAN_LIMIT = 400;

/**
 * Reports one non-integer amount for `context`, then goes silent for that
 * context. console.error, never throw: the rendering philosophy is
 * degrade-visibly-never-invent (a bad balance renders truncated, an absent
 * balance renders no span), so the warning is a diagnostic side channel
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
    `[@cynco/accounts] ${context}: amounts must be integer minor units — ` +
      `got ${value}; multiply by the currency's minor-unit factor, ` +
      `e.g. RM 12.50 → 1250.`
  );
}

/** Clears the once-per-context memory. @internal Test hook only. */
export function resetInvalidMinorUnitsWarnings(): void {
  warnedContexts.clear();
}

/**
 * Boundary check for entry posting amounts. Called where ledger data enters
 * the controller (the store rebuild choke point), never from projection or
 * render paths.
 *
 * @internal
 */
export function warnIfInvalidLedgerEntries(
  context: string,
  entries: readonly LedgerEntry[]
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  let scanned = 0;
  for (const entry of entries) {
    for (const posting of entry.postings) {
      if (scanned >= BOUNDARY_SCAN_LIMIT) {
        return;
      }
      scanned += 1;
      if (!isValidMinorUnits(posting.amount)) {
        warnInvalidMinorUnits(context, posting.amount);
        return;
      }
    }
  }
}
