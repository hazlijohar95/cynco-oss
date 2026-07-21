export * from './components/BalanceSheet';
export * from './components/IncomeStatement';
export * from './components/TrialBalance';
export * from './components/web-components';
export * from './constants';
export * from './renderers/BalanceSheetRenderer';
export * from './renderers/IncomeStatementRenderer';
export * from './renderers/statementTable';
export * from './renderers/TrialBalanceRenderer';
export type { AmountFormat, ColorScheme } from './types';
export * from './utils/applyHostColorScheme';
export * from './utils/escapeHtml';
export * from './utils/formatMinorUnits';
export * from './utils/resolveAmountFormat';
export * from './utils/statementsThemeVariables';

// The statements DX surface of the data engine, re-exported so consumers
// derive and render from one package. @cynco/ledger-core is private and
// inlined into dist at build time (tsdown noExternal) — these re-exports are
// rewritten to the inlined copies, and the post-build guard asserts no
// engine specifier survives in the payload.
export {
  checkBalanceAssertions,
  createAccountTaxonomy,
  createOpeningBalanceEntry,
  DEFAULT_CURRENCY_EXPONENTS,
  DEFAULT_OPENING_BALANCE_ACCOUNT,
  DEFAULT_ROOT_ACCOUNT_TYPES,
  deriveBalanceSheet,
  deriveIncomeStatement,
  deriveTrialBalance,
  getCurrencyExponent,
  getNormalBalanceForType,
  getStatementRoleForType,
  matchesEntryFilter,
  negateMinorUnits,
} from '@cynco/ledger-core';
export type {
  AccountClassification,
  AccountTaxonomy,
  AccountTaxonomyOptions,
  AccountTaxonomyOverride,
  AccountType,
  BalanceAssertion,
  BalanceAssertionResult,
  BalanceSheetData,
  BalanceSheetOptions,
  BalanceSheetSection,
  EntryFilter,
  EntryFlag,
  IncomeStatementData,
  IncomeStatementOptions,
  IncomeStatementSection,
  LedgerEntry,
  MinorUnits,
  NormalBalance,
  OpeningBalanceLine,
  OpeningBalanceOptions,
  Posting,
  StatementDate,
  StatementLine,
  StatementPeriod,
  StatementRole,
  TrialBalanceData,
  TrialBalanceOptions,
  TrialBalanceRow,
  TrialBalanceSection,
  UnclassifiedBalance,
} from '@cynco/ledger-core';
