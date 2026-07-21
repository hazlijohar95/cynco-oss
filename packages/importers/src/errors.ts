/** Machine-readable classification of an import failure. */
export type ImportErrorCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_DECIMALS'
  | 'AMOUNT_OVERFLOW'
  | 'DATE_INVALID'
  | 'CSV_STRUCTURE'
  | 'CSV_COLUMN'
  | 'BALANCE_MISSING'
  | 'OFX_STRUCTURE'
  | 'OFX_CURRENCY_MISSING';

/**
 * The only error type importers throw. Structurally-broken input (an
 * unterminated quote, a mapping naming a header that does not exist, a
 * statement with no currency) throws; row-level problems never do — they land
 * in the result's `skipped` list with a reason so one bad line cannot abort a
 * whole import. Bare strings are never thrown: callers need `code` to branch
 * and `line` to point the user at the offending input.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** 1-based line (CSV) or transaction ordinal (OFX) when the failure is localized. */
  readonly line: number | undefined;

  constructor(code: ImportErrorCode, message: string, line?: number) {
    super(line == null ? message : `line ${line}: ${message}`);
    this.name = 'ImportError';
    this.code = code;
    this.line = line;
  }
}
