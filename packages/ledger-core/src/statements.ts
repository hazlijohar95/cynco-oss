// Shared shapes for the statement derivations (trial balance, income
// statement, balance sheet). Derivations are report-time queries: one linear
// pass over plain entries, grouped per currency — never a per-account
// register rebuild — and they inherit the suite's honesty rules: void
// entries are excluded from meaning, unsafe amounts are skipped exactly like
// `sumPostingsByCurrency` skips them, aggregate overflow is flagged and
// never repaired, and unclassifiable accounts are surfaced instead of
// guessed into a section.

import type { AccountClassification } from './taxonomy';
import type { MinorUnits } from './types';

/**
 * One reporting period (inclusive on both ends) for period-activity
 * statements: an income statement column is the account activity inside a
 * period. Comparative statements pass several periods; every line carries
 * one amount per period, in the same order.
 */
export interface StatementPeriod {
  /** Display label: `FY2025`, `Jan 2025`, `Q1`. */
  label: string;
  /** Inclusive ISO date lower bound (`YYYY-MM-DD`). */
  dateFrom: string;
  /** Inclusive ISO date upper bound (`YYYY-MM-DD`). */
  dateTo: string;
}

/**
 * One reporting date for position statements: a balance sheet column is the
 * cumulative balance through the end of `asOf`. The optional fiscal-year
 * start splits the computed earnings line for that column; see
 * `deriveBalanceSheet`.
 */
export interface StatementDate {
  /** Display label: `31 Dec 2025`. */
  label: string;
  /** Inclusive ISO date the column reports through (`YYYY-MM-DD`). */
  asOf: string;
  /**
   * Start of the fiscal year the column sits in. When present, income and
   * expense activity from this date through `asOf` reports as current-year
   * earnings and everything before it as retained earnings; when absent the
   * whole cumulative result reports as retained earnings.
   */
  fiscalYearStart?: string;
}

/**
 * One account line of a financial statement. Amounts are
 * presentation-signed by section — the sign flip every statement performs so
 * revenue and liabilities read as positive magnitudes:
 *
 * - income, liabilities, equity sections: amount = −(signed ledger balance)
 * - expense and asset sections: amount = +(signed ledger balance)
 *
 * The flip follows the section, not the account, so contra accounts
 * naturally render negative inside their section (sales returns show as a
 * negative income line). The raw ledger-signed value is recoverable by
 * undoing the section flip.
 */
export interface StatementLine {
  /** Canonical colon-delimited account path. */
  account: string;
  /** The taxonomy classification that routed this line into its section. */
  classification: AccountClassification;
  /** Presentation-signed amount per period/date column, in column order. */
  amounts: readonly MinorUnits[];
}

/**
 * An account the taxonomy could not classify but which carries activity the
 * statement would otherwise silently drop. Amounts are raw ledger-signed
 * (no section, so no presentation flip applies). Statements list these so
 * a renderer can flag them; they are never guessed into a section.
 */
export interface UnclassifiedBalance {
  /** Canonical colon-delimited account path. */
  account: string;
  /** Signed ledger balance per column, in column order. */
  amounts: readonly MinorUnits[];
}
