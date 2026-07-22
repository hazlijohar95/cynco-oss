// Public types for @cynco/statements. The statement data shapes and the
// shared money-kernel shapes come from @cynco/ledger-core — one definition
// for the whole suite, re-exported so consumers get everything from this
// package.

/**
 * How the component's `light-dark()` color defaults resolve. `system`
 * (default) leaves resolution to the page/OS; `light`/`dark` pin the scheme
 * via an inline `color-scheme` on the host element.
 */
export type ColorScheme = 'light' | 'dark' | 'system';

export type {
  AmountFormat,
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
