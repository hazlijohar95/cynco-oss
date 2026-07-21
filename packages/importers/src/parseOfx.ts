import { ImportError } from './errors';
import type {
  ImportedStatementLine,
  OfxParseOptions,
  OfxParseResult,
  OfxStatement,
  SkippedLine,
} from './types';
import { parseAmountToMinorUnits } from './utils/parseAmountToMinorUnits';
import { parseDateToIso } from './utils/parseDateToIso';

/**
 * Matches one tag: optional `/` for closes, a name, and any attribute tail
 * (2.x XML). The name must start with a letter, so `<?xml?>` processing
 * instructions, the 1.x `KEY:VALUE` header lines (which contain no `<` at
 * all), and comparison operators in values never register as tags.
 */
const TAG_PATTERN = /<(\/?)([A-Za-z][A-Za-z0-9._]*)(?:[^<>]*)>/g;

/** The five character entities OFX 2.x files actually use. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (match) => ENTITIES[match] ?? match
  );
}

/** Fields of one STMTTRN aggregate as raw strings, before validation. */
interface RawTransaction {
  dtposted: string | null;
  trnamt: string | null;
  fitid: string | null;
  name: string | null;
  memo: string | null;
  /** 1-based STMTTRN ordinal across the whole file, for skip reporting. */
  ordinal: number;
}

/** Mutable per-statement accumulator; emitted once the next statement opens. */
interface StatementBuilder {
  accountId: string;
  currency: string | null;
  lines: ImportedStatementLine[];
}

/**
 * `DTPOSTED` carries `YYYYMMDD` optionally followed by time and a
 * `[gmt offset:tz]` suffix. Only the date prefix matters to a ledger — bank
 * posting timestamps are server-local noise — so everything after the first
 * eight digits is deliberately ignored.
 */
function parseDtPosted(value: string): string {
  const digits = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (digits == null) {
    throw new ImportError(
      'DATE_INVALID',
      `DTPOSTED ${JSON.stringify(value)} does not start with YYYYMMDD`
    );
  }
  // Re-validate through the calendar-aware ISO parser so 20260231 fails.
  return parseDateToIso(`${digits[1]}-${digits[2]}-${digits[3]}`, 'YYYY-MM-DD');
}

/**
 * TRNAMT is a signed decimal, `.`-separated per spec, but some European banks
 * emit `,` — accept it only when no `.` is present, so `1.234,56` (grouped)
 * still fails loudly instead of parsing 1000× off.
 */
function parseTrnAmt(value: string, currency: string): number {
  const decimal = !value.includes('.') && value.includes(',') ? ',' : '.';
  return parseAmountToMinorUnits(value, { decimal }, currency);
}

/**
 * Parses OFX 1.x (SGML — leaf elements have no closing tags) and OFX 2.x
 * (XML) with one tolerant tag scanner instead of an XML dependency: a leaf's
 * value is simply the text between its open tag and the next `<`, which holds
 * in both dialects, and aggregate close tags (present in both) drive the
 * statement/transaction state machine. Multiple statements per file
 * (BANKMSGSRS with several STMTRS, or bank + credit card) come back as
 * separate `{ accountId, currency, lines }` groups.
 *
 * Amount signs pass through untouched — OFX amounts are already signed from
 * the account holder's perspective (positive = money in), matching
 * `StatementLine`. Transactions missing FITID, DTPOSTED, or TRNAMT (or
 * carrying malformed values) are skipped with a reason keyed by the
 * transaction's ordinal; a file with no `<OFX>` envelope at all, or money
 * with no currency in sight (no CURDEF and no `defaultCurrency`), throws.
 */
export function parseOfx(
  text: string,
  options: OfxParseOptions = {}
): OfxParseResult {
  if (!/<OFX/i.test(text)) {
    throw new ImportError('OFX_STRUCTURE', 'no <OFX> envelope found');
  }

  const statements: OfxStatement[] = [];
  const skipped: SkippedLine[] = [];
  let current: StatementBuilder | null = null;
  let transaction: RawTransaction | null = null;
  let ordinal = 0;

  const requireStatement = (): StatementBuilder => {
    current ??= { accountId: '', currency: null, lines: [] };
    return current;
  };

  const flushStatement = (): void => {
    if (current == null) return;
    if (current.lines.length > 0 || current.accountId !== '') {
      const currency = current.currency ?? options.defaultCurrency;
      if (currency === undefined && current.lines.length > 0) {
        throw new ImportError(
          'OFX_CURRENCY_MISSING',
          `statement ${JSON.stringify(current.accountId)} has transactions but no CURDEF; pass defaultCurrency`
        );
      }
      statements.push({
        accountId: current.accountId,
        currency: currency ?? '',
        lines: current.lines,
      });
    }
    current = null;
  };

  const flushTransaction = (): void => {
    if (transaction == null) return;
    const txn = transaction;
    transaction = null;
    const statement = requireStatement();
    try {
      if (txn.fitid == null || txn.fitid === '') {
        throw new ImportError('OFX_STRUCTURE', 'transaction has no FITID');
      }
      if (txn.dtposted == null) {
        throw new ImportError('DATE_INVALID', 'transaction has no DTPOSTED');
      }
      if (txn.trnamt == null) {
        throw new ImportError('AMOUNT_INVALID', 'transaction has no TRNAMT');
      }
      const currency = statement.currency ?? options.defaultCurrency;
      if (currency === undefined) {
        throw new ImportError(
          'OFX_CURRENCY_MISSING',
          'transaction seen before any CURDEF and no defaultCurrency given'
        );
      }
      const name = txn.name ?? '';
      const memo = txn.memo ?? '';
      statement.lines.push({
        id: txn.fitid,
        date: parseDtPosted(txn.dtposted),
        description:
          name !== '' && memo !== ''
            ? `${name} ${memo}`
            : name !== ''
              ? name
              : memo,
        amount: parseTrnAmt(txn.trnamt, currency),
        currency,
      });
    } catch (error) {
      // Currency absence is a file-level configuration problem, not a bad
      // row: skipping would silently drop EVERY transaction, so it escapes.
      if (
        error instanceof ImportError &&
        error.code !== 'OFX_CURRENCY_MISSING'
      ) {
        skipped.push({ line: txn.ordinal, reason: error.message });
        return;
      }
      throw error;
    }
  };

  TAG_PATTERN.lastIndex = 0;
  let match = TAG_PATTERN.exec(text);
  while (match != null) {
    const isClose = match[1] === '/';
    const name = (match[2] ?? '').toUpperCase();
    const valueEnd = text.indexOf('<', TAG_PATTERN.lastIndex);
    const value = decodeEntities(
      text
        .slice(TAG_PATTERN.lastIndex, valueEnd === -1 ? text.length : valueEnd)
        .trim()
    );

    if (!isClose) {
      switch (name) {
        case 'STMTRS':
        case 'CCSTMTRS': {
          flushTransaction();
          flushStatement();
          requireStatement();
          break;
        }
        case 'CURDEF': {
          requireStatement().currency = value;
          break;
        }
        case 'ACCTID': {
          // First ACCTID wins: BANKACCTFROM/CCACCTFROM precede the
          // transaction list, and transfer targets (BANKACCTTO) come later.
          const statement = requireStatement();
          if (statement.accountId === '') statement.accountId = value;
          break;
        }
        case 'STMTTRN': {
          // 1.x files that omit </STMTTRN> still parse: the next open ends
          // the previous transaction.
          flushTransaction();
          ordinal += 1;
          transaction = {
            dtposted: null,
            trnamt: null,
            fitid: null,
            name: null,
            memo: null,
            ordinal,
          };
          break;
        }
        case 'DTPOSTED':
        case 'TRNAMT':
        case 'FITID':
        case 'NAME':
        case 'MEMO': {
          if (transaction != null) {
            if (name === 'DTPOSTED') transaction.dtposted = value;
            else if (name === 'TRNAMT') transaction.trnamt = value;
            else if (name === 'FITID') transaction.fitid = value;
            else if (name === 'NAME') transaction.name = value;
            else transaction.memo = value;
          }
          break;
        }
        case 'LEDGERBAL':
        case 'AVAILBAL': {
          flushTransaction();
          break;
        }
        default:
          break;
      }
    } else if (name === 'STMTTRN') {
      flushTransaction();
    } else if (
      name === 'BANKTRANLIST' ||
      name === 'STMTRS' ||
      name === 'CCSTMTRS'
    ) {
      flushTransaction();
    }

    match = TAG_PATTERN.exec(text);
  }

  flushTransaction();
  flushStatement();
  return { statements, skipped };
}
