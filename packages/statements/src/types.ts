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
