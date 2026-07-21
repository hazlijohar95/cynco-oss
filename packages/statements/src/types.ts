// Public types for @cynco/statements. The statement data shapes come from
// @cynco/ledger-core, which is inlined into dist at build time (tsdown
// noExternal); the re-exports below are rewritten to the inlined copies, so
// no published declaration ever imports the private engine package.

/**
 * How the component's `light-dark()` color defaults resolve. `system`
 * (default) leaves resolution to the page/OS; `light`/`dark` pin the scheme
 * via an inline `color-scheme` on the host element.
 */
export type ColorScheme = 'light' | 'dark' | 'system';

/**
 * Locale-shaped amount presentation: which separators to use and how to
 * group integer digits. Plain data by design — it survives structured clone
 * and JSON unchanged, which is what lets server and client render
 * byte-identical amounts. Renderers must NEVER consult Intl.NumberFormat
 * for this (ICU tables differ between Node versions and browsers, so the
 * same locale can format differently on server and client); hosts resolve a
 * descriptor once at their boundary (see `resolveAmountFormat`) and thread
 * the same object everywhere.
 *
 * MUST stay in lockstep with the identical interface in
 * `@cynco/journals/src/types.ts` and `@cynco/accounts/src/types.ts` — the
 * packages deliberately share no runtime dependency for this, so the shape
 * is duplicated (the currency-exponent-table precedent).
 */
export interface AmountFormat {
  /** Decimal separator, e.g. `.` or `,`. */
  decimal: string;
  /**
   * Group separator, e.g. `,`, `.`, `\u202f` (narrow no-break space), `'`.
   * An empty string disables grouping entirely.
   */
  group: string;
  /**
   * Group sizes from the decimal point outward; the LAST size repeats for
   * the remaining digits. `[3]` gives `1,234,567`; `[3,2]` gives the Indian
   * `12,34,567`.
   */
  groupSizes: readonly number[];
}

export type {
  BalanceSheetData,
  BalanceSheetSection,
  IncomeStatementData,
  IncomeStatementSection,
  MinorUnits,
  StatementDate,
  StatementLine,
  StatementPeriod,
  TrialBalanceData,
  TrialBalanceRow,
  TrialBalanceSection,
  UnclassifiedBalance,
} from '@cynco/ledger-core';
