import type {
  BalanceSheetData,
  IncomeStatementData,
  MinorUnits,
  StatementLine,
  TrialBalanceData,
  UnclassifiedBalance,
} from '../types';

/**
 * True when `value` is usable as an exact integer minor-unit amount.
 * `MinorUnits` is a bare `number` alias for ergonomics, so nothing stops a
 * host passing major units (`12.5` for RM 12.50) — which the renderers then
 * degrade to `0.12`-ish output (fractional input truncates; see
 * formatMinorUnits). Hosts can use this predicate to validate their own
 * data before it enters a renderer or component.
 */
export function isValidMinorUnits(value: MinorUnits): boolean {
  return Number.isSafeInteger(value);
}

// Once-per-context memory for the boundary warnings below, bounded two ways:
// each context warns at most once (re-rendering the same bad dataset stays
// silent), and the set itself is capped so dynamically generated context
// keys can never grow memory. Module-level rather than per-instance so a
// host rendering many statements over the same bad data gets one actionable
// message instead of a spam wall.
const MAX_WARNED_CONTEXTS = 32;
const warnedContexts = new Set<string>();

// The repo has no dev/prod gating idiom (no NODE_ENV or import.meta.env
// branches anywhere in the packages), so these checks run unconditionally.
// They stay cheap instead: they run once per renderer call — which the
// client components already reference-gate to new data, and which is O(n)
// string building anyway — the scan is capped at this many amounts (bad
// boundary data is systematic — a host converting units wrong converts
// every line wrong, so the head of the data is as good as the whole), and
// an already-warned context short-circuits before scanning at all.
const BOUNDARY_SCAN_LIMIT = 400;

/**
 * Reports one non-integer amount for `context`, then goes silent for that
 * context. console.error, never throw: the rendering philosophy is
 * degrade-visibly-never-invent (a bad amount renders truncated, an
 * out-of-balance section renders honestly), so the warning is a diagnostic
 * side channel that must never alter rendered output — the renderer string
 * output stays byte-identical whether or not it fires.
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
    `[@cynco/statements] ${context}: amounts must be integer minor units — ` +
      `got ${value}; multiply by the currency's minor-unit factor, ` +
      `e.g. RM 12.50 → 1250.`
  );
}

/** Clears the once-per-context memory. @internal Test hook only. */
export function resetInvalidMinorUnitsWarnings(): void {
  warnedContexts.clear();
}

/** Capped scan over a batch of amounts; returns the first invalid one. */
function findInvalidAmount(
  batches: Iterable<readonly (MinorUnits | null)[]>
): number | null {
  let scanned = 0;
  for (const amounts of batches) {
    for (const amount of amounts) {
      if (scanned >= BOUNDARY_SCAN_LIMIT) {
        return null;
      }
      scanned += 1;
      // Null is a legitimate "no value" in these shapes (e.g. a trial
      // balance without adjustments), not bad data.
      if (amount != null && !isValidMinorUnits(amount)) {
        return amount;
      }
    }
  }
  return null;
}

function* lineAmounts(
  lines: readonly (StatementLine | UnclassifiedBalance)[]
): Generator<readonly MinorUnits[]> {
  for (const line of lines) {
    yield line.amounts;
  }
}

/**
 * Boundary check for a derived trial balance entering rendering.
 * @internal
 */
export function warnIfInvalidTrialBalanceAmounts(
  context: string,
  data: TrialBalanceData
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  function* batches(): Generator<readonly (MinorUnits | null)[]> {
    for (const section of data.sections) {
      yield [section.totalDebit, section.totalCredit];
      for (const row of section.rows) {
        yield [row.balance, row.unadjusted, row.adjustment];
      }
    }
  }
  const invalid = findInvalidAmount(batches());
  if (invalid != null) {
    warnInvalidMinorUnits(context, invalid);
  }
}

/**
 * Boundary check for a derived income statement entering rendering.
 * @internal
 */
export function warnIfInvalidIncomeStatementAmounts(
  context: string,
  data: IncomeStatementData
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  function* batches(): Generator<readonly (MinorUnits | null)[]> {
    for (const section of data.sections) {
      yield section.totalIncome;
      yield section.totalExpenses;
      yield section.netIncome;
      yield* lineAmounts(section.income);
      yield* lineAmounts(section.expenses);
      yield* lineAmounts(section.unclassified);
    }
  }
  const invalid = findInvalidAmount(batches());
  if (invalid != null) {
    warnInvalidMinorUnits(context, invalid);
  }
}

/**
 * Boundary check for a derived balance sheet entering rendering.
 * @internal
 */
export function warnIfInvalidBalanceSheetAmounts(
  context: string,
  data: BalanceSheetData
): void {
  if (warnedContexts.has(context)) {
    return;
  }
  function* batches(): Generator<readonly (MinorUnits | null)[]> {
    for (const section of data.sections) {
      yield section.retainedEarnings;
      yield section.currentEarnings;
      yield section.totalAssets;
      yield section.totalLiabilities;
      yield section.totalEquity;
      yield* lineAmounts(section.assets);
      yield* lineAmounts(section.liabilities);
      yield* lineAmounts(section.equity);
      yield* lineAmounts(section.unclassified);
    }
  }
  const invalid = findInvalidAmount(batches());
  if (invalid != null) {
    warnInvalidMinorUnits(context, invalid);
  }
}
