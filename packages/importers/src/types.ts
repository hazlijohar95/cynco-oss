// The shared money-kernel shapes come from the engine — one definition for
// the whole suite. Re-exported so importer output plugs into the journals
// reconciliation UI with no adaptation (both packages speak the engine's
// shapes), and every internal `./types` import keeps working.
import type { BankStatementLine, MinorUnits } from '@cynco/ledger-core';

export type {
  EntryFlag,
  LedgerEntry,
  MinorUnits,
  Posting,
} from '@cynco/ledger-core';
/**
 * One line of a bank statement, already parsed to integer minor units — the
 * engine's `BankStatementLine`, re-exported under the name this package has
 * always used. This is the exact shape `proposeMatches` and the journals
 * Reconciliation UI consume.
 */
export type { BankStatementLine as StatementLine } from '@cynco/ledger-core';

/**
 * A parsed statement line plus the import-only extras the source carried.
 * Structurally a superset of {@link StatementLine}, so parser output is
 * assignable to the journals reconciliation input as-is; the extras exist so
 * `proveRunningBalance` can verify the source's own balance column and so
 * hosts can trace a line back to its bank reference.
 */
export interface ImportedStatementLine extends BankStatementLine {
  /** Running balance after this line in minor units, when the source has one. */
  balance?: MinorUnits;
  /** Source reference (cheque number, bank transaction code), when mapped. */
  reference?: string;
}

/** A column identified by 0-based index or, with a header row, by header name. */
export type CsvColumnRef = number | string;

/**
 * Where the signed amount lives: a single signed column, or the split
 * debit/credit pair many banks export. With the split pair, credit is money
 * IN (deposits positive — the statement is written from the account holder's
 * perspective) and debit is money OUT, so `amount = credit − debit`.
 */
export type CsvAmountColumns =
  | CsvColumnRef
  | { debit: CsvColumnRef; credit: CsvColumnRef };

/**
 * Explicit date formats only — no sniffing. `01/02/2026` is ambiguous between
 * DD/MM and MM/DD, and a wrong guess corrupts every date in the import
 * silently, so the caller must state what the bank exports.
 */
export type CsvDateFormat =
  | 'YYYY-MM-DD'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'DD.MM.YYYY';

/**
 * Decimal and group separators, stated explicitly for the same reason as the
 * date format: `1.234` is one-point-two-three-four in one locale and one
 * thousand two hundred thirty-four in another.
 */
export interface CsvAmountFormat {
  decimal: '.' | ',';
  /** Thousands separator to strip, e.g. `,`, `.`, ` `. Omit when none. */
  group?: string;
}

/** Explicit column mapping for {@link parseCsvStatement}. */
export interface CsvMapping {
  /** Field delimiter. Defaults to `,`. */
  delimiter?: ',' | ';' | '\t';
  /**
   * Whether the first record is a header row. Defaults to true when any
   * column reference is a header name (names are unresolvable without one),
   * false when every reference is an index.
   */
  hasHeader?: boolean;
  columns: {
    date: CsvColumnRef;
    description: CsvColumnRef;
    amount: CsvAmountColumns;
    /** Running balance column, enabling {@link proveRunningBalance}. */
    balance?: CsvColumnRef;
    /** Bank reference column, surfaced as `ImportedStatementLine.reference`. */
    reference?: CsvColumnRef;
  };
  dateFormat: CsvDateFormat;
  amountFormat: CsvAmountFormat;
  /** ISO 4217 or commodity code applied to every line, e.g. `MYR`. */
  currency: string;
}

/**
 * A source row the parser could not turn into a statement line, with the
 * 1-based location and the reason. Rows are skipped WITH a reason or parsed —
 * never silently dropped; the caller decides whether skips are acceptable.
 */
export interface SkippedLine {
  /** 1-based physical line for CSV; 1-based transaction ordinal for OFX. */
  line: number;
  reason: string;
}

export interface CsvParseResult {
  lines: ImportedStatementLine[];
  skipped: SkippedLine[];
}

/** One account's transactions from an OFX file (files can carry several). */
export interface OfxStatement {
  /** ACCTID from BANKACCTFROM/CCACCTFROM; empty string when absent. */
  accountId: string;
  /** CURDEF, or the `defaultCurrency` fallback. */
  currency: string;
  lines: ImportedStatementLine[];
}

export interface OfxParseResult {
  statements: OfxStatement[];
  skipped: SkippedLine[];
}

export interface OfxParseOptions {
  /**
   * Currency used when a statement carries no CURDEF. Without either, a
   * statement that has transactions throws — money without a currency is
   * meaningless and importers never guess.
   */
  defaultCurrency?: string;
}

/** One running-balance mismatch found by {@link proveRunningBalance}. */
export interface BalanceBreak {
  /** 0-based index into the lines array where the proof first diverged. */
  index: number;
  /** Opening + Σ amounts through this line, in minor units. */
  expected: MinorUnits;
  /** The balance the source claimed, in minor units. */
  actual: MinorUnits;
}

export type BalanceProof = { ok: true } | { ok: false; breaks: BalanceBreak[] };

export interface ToDraftEntriesOptions {
  /** Ledger account the statement belongs to, e.g. `Assets:Current:Cash-Maybank`. */
  account: string;
  /** Counterposting account for the unclassified side, e.g. `Equity:Suspense`. */
  suspenseAccount: string;
  /** Overrides the lines' own currency when the ledger books under another code. */
  currency?: string;
}
