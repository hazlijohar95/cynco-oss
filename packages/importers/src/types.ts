/** Integer minor units (sen, cents). Never floats. */
export type MinorUnits = number;

export type EntryFlag = 'cleared' | 'pending' | 'flagged' | 'void';

/**
 * MUST mirror `Posting` in `@cynco/journals/src/types.ts`. Importers feed the
 * journals reconciliation UI, but a domain package may not depend on another
 * domain package (scripts/assert-tiers.ts forbids the sideways edge), so the
 * consumed shapes are duplicated here — the same lockstep-duplication idiom
 * journals uses for the engine's currency table. test/lockstepParity.test.ts
 * fails the moment either side drifts.
 */
export interface Posting {
  /** Canonical colon-delimited account path, e.g. `Assets:Current:Cash-Maybank`. */
  account: string;
  /** Signed integer minor units. Positive = debit, negative = credit. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. `MYR`, `USD`. */
  currency: string;
}

/**
 * MUST mirror `LedgerEntry` in `@cynco/journals/src/types.ts` — see the
 * {@link Posting} note for why the shape is duplicated rather than imported.
 */
export interface LedgerEntry {
  /** Stable unique id (caller-provided). */
  id: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  flag: EntryFlag;
  payee: string | null;
  narration: string;
  tags: readonly string[];
  links: readonly string[];
  postings: readonly Posting[];
}

/**
 * One line of a bank statement, already parsed to integer minor units.
 *
 * MUST mirror `StatementLine` in `@cynco/journals/src/types.ts` — this is the
 * exact shape `proposeMatches` and the Reconciliation UI consume, so parser
 * output plugs into journals with no adaptation. Duplicated, not imported;
 * see the {@link Posting} note and test/lockstepParity.test.ts.
 */
export interface StatementLine {
  /** Stable unique id (caller-provided). */
  id: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  description: string;
  /** Signed from the account's perspective: deposits positive. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. `MYR`. */
  currency: string;
}

/**
 * A parsed statement line plus the import-only extras the source carried.
 * Structurally a superset of {@link StatementLine}, so parser output is
 * assignable to the journals reconciliation input as-is; the extras exist so
 * `proveRunningBalance` can verify the source's own balance column and so
 * hosts can trace a line back to its bank reference.
 */
export interface ImportedStatementLine extends StatementLine {
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
