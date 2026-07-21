import { ImportError } from './errors';
import type {
  CsvColumnRef,
  CsvMapping,
  CsvParseResult,
  ImportedStatementLine,
  MinorUnits,
  SkippedLine,
} from './types';
import { hashLine } from './utils/hashLine';
import { parseAmountToMinorUnits } from './utils/parseAmountToMinorUnits';
import { parseDateToIso } from './utils/parseDateToIso';

/** One tokenized record: its fields, raw source slice, and 1-based start line. */
interface CsvRecord {
  fields: string[];
  /** The record's exact source text, used for deterministic line ids. */
  raw: string;
  /** 1-based physical line the record starts on (quoted fields can span lines). */
  line: number;
}

/**
 * RFC 4180-style tokenizer: quoted fields may contain the delimiter, escaped
 * quotes (`""`), and embedded newlines; CRLF, LF, and bare CR all end a
 * record. Hand-rolled because the package is zero-dependency and the state
 * machine is small; an unterminated quote throws `CSV_STRUCTURE` (the file is
 * broken, not one row — everything after the runaway quote would be garbage).
 */
function tokenize(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  /** Whether the current field had a quote — `""` must yield a real (empty) field. */
  let sawQuote = false;
  let line = 1;
  let recordLine = 1;
  let recordStart = 0;

  const pushField = (): void => {
    fields.push(field);
    field = '';
    sawQuote = false;
  };
  const pushRecord = (end: number): void => {
    pushField();
    records.push({
      fields,
      raw: text.slice(recordStart, end),
      line: recordLine,
    });
    fields = [];
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (char === '\n') line += 1;
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      sawQuote = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      pushField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      pushRecord(index);
      // Consume CRLF as one terminator so \r\n never yields a phantom record.
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
      recordStart = index;
      continue;
    }
    field += char;
    index += 1;
  }

  if (inQuotes) {
    throw new ImportError(
      'CSV_STRUCTURE',
      'unterminated quoted field (runaway quote reaches end of file)',
      recordLine
    );
  }
  // A trailing newline is a terminator, not an empty final record.
  if (field !== '' || fields.length > 0 || sawQuote) {
    pushRecord(text.length);
  }
  return records;
}

/** Resolves a column reference to an index, via the header row when named. */
function resolveColumn(
  ref: CsvColumnRef,
  header: readonly string[] | null,
  role: string
): number {
  if (typeof ref === 'number') return ref;
  if (header == null) {
    throw new ImportError(
      'CSV_COLUMN',
      `column ${JSON.stringify(ref)} (${role}) is a header name but the mapping declares no header row`
    );
  }
  const index = header.indexOf(ref);
  if (index === -1) {
    throw new ImportError(
      'CSV_COLUMN',
      `column ${JSON.stringify(ref)} (${role}) not found in header row [${header.join(', ')}]`
    );
  }
  return index;
}

/** Reads a field by resolved index; a record too short for it is a row error. */
function readField(record: CsvRecord, index: number, role: string): string {
  const value = record.fields[index];
  if (value === undefined) {
    throw new ImportError(
      'CSV_COLUMN',
      `record has ${record.fields.length} fields, ${role} column ${index} is missing`
    );
  }
  return value.trim();
}

/**
 * Parses a raw CSV bank export into statement lines under an EXPLICIT column
 * mapping — no delimiter/date/decimal sniffing, because every silent guess
 * that goes wrong corrupts an entire import identically (the worst kind of
 * bug to spot). Malformed rows are skipped with a reason, never dropped and
 * never repaired; structural breakage (runaway quote, unknown header name)
 * throws {@link ImportError}.
 *
 * Line ids are `csv:<fnv1a of the raw record>`, with a `:<n>` occurrence
 * suffix for byte-identical rows, so re-running the same import yields the
 * same ids (dedupe-friendly) while two genuinely identical transactions still
 * get distinct ids.
 *
 * With split debit/credit columns the amount is `credit − debit`: statements
 * are written from the account holder's perspective, so credit is money in
 * and the resulting sign matches `StatementLine`'s deposits-positive
 * contract.
 */
export function parseCsvStatement(
  text: string,
  mapping: CsvMapping
): CsvParseResult {
  const delimiter = mapping.delimiter ?? ',';
  const { columns } = mapping;
  const namedRefs: CsvColumnRef[] = [
    columns.date,
    columns.description,
    ...(typeof columns.amount === 'object'
      ? [columns.amount.debit, columns.amount.credit]
      : [columns.amount]),
    ...(columns.balance === undefined ? [] : [columns.balance]),
    ...(columns.reference === undefined ? [] : [columns.reference]),
  ];
  // Header names are unresolvable without a header row, so their presence is
  // the natural default; an explicit `hasHeader` always wins.
  const hasHeader =
    mapping.hasHeader ?? namedRefs.some((ref) => typeof ref === 'string');

  const records = tokenize(text, delimiter);
  const header = hasHeader ? (records[0]?.fields ?? null) : null;
  const dataRecords = hasHeader ? records.slice(1) : records;

  const dateIndex = resolveColumn(columns.date, header, 'date');
  const descriptionIndex = resolveColumn(
    columns.description,
    header,
    'description'
  );
  const amountIndexes: { debit: number; credit: number } | { single: number } =
    typeof columns.amount === 'object'
      ? {
          debit: resolveColumn(columns.amount.debit, header, 'debit'),
          credit: resolveColumn(columns.amount.credit, header, 'credit'),
        }
      : { single: resolveColumn(columns.amount, header, 'amount') };
  const balanceIndex =
    columns.balance === undefined
      ? null
      : resolveColumn(columns.balance, header, 'balance');
  const referenceIndex =
    columns.reference === undefined
      ? null
      : resolveColumn(columns.reference, header, 'reference');

  const lines: ImportedStatementLine[] = [];
  const skipped: SkippedLine[] = [];
  const idOccurrences = new Map<string, number>();

  for (const record of dataRecords) {
    // Blank interior lines are reported, not silently dropped — a blank line
    // mid-statement often means a truncated export the user should look at.
    if (record.fields.length === 1 && record.fields[0]?.trim() === '') {
      skipped.push({ line: record.line, reason: 'blank line' });
      continue;
    }
    try {
      const date = parseDateToIso(
        readField(record, dateIndex, 'date'),
        mapping.dateFormat
      );
      const description = readField(record, descriptionIndex, 'description');

      let amount: MinorUnits;
      if ('single' in amountIndexes) {
        amount = parseAmountToMinorUnits(
          readField(record, amountIndexes.single, 'amount'),
          mapping.amountFormat,
          mapping.currency
        );
      } else {
        const debitText = readField(record, amountIndexes.debit, 'debit');
        const creditText = readField(record, amountIndexes.credit, 'credit');
        const debit =
          debitText === ''
            ? 0
            : parseAmountToMinorUnits(
                debitText,
                mapping.amountFormat,
                mapping.currency
              );
        const credit =
          creditText === ''
            ? 0
            : parseAmountToMinorUnits(
                creditText,
                mapping.amountFormat,
                mapping.currency
              );
        if (debitText === '' && creditText === '') {
          throw new ImportError(
            'AMOUNT_INVALID',
            'both debit and credit are empty'
          );
        }
        if (debit !== 0 && credit !== 0) {
          throw new ImportError(
            'AMOUNT_INVALID',
            'both debit and credit are populated — ambiguous direction'
          );
        }
        amount = credit - debit;
      }

      const line: ImportedStatementLine = {
        id: '',
        date,
        description,
        amount,
        currency: mapping.currency,
      };
      if (balanceIndex != null) {
        line.balance = parseAmountToMinorUnits(
          readField(record, balanceIndex, 'balance'),
          mapping.amountFormat,
          mapping.currency
        );
      }
      if (referenceIndex != null) {
        const reference = readField(record, referenceIndex, 'reference');
        if (reference !== '') line.reference = reference;
      }

      const hash = hashLine(record.raw);
      const occurrence = (idOccurrences.get(hash) ?? 0) + 1;
      idOccurrences.set(hash, occurrence);
      line.id = occurrence === 1 ? `csv:${hash}` : `csv:${hash}:${occurrence}`;

      lines.push(line);
    } catch (error) {
      // Structural errors concern the whole file and must escape; only
      // row-scoped failures become skips.
      if (error instanceof ImportError && error.code !== 'CSV_STRUCTURE') {
        skipped.push({ line: record.line, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  return { lines, skipped };
}
