import {
  getCurrencyDecimals,
  type LedgerEntry,
  type MinorUnits,
} from '@cynco/journals';
import { isValidAccountPath } from '@cynco/ledger-store';

export interface ParsedCsvLedger {
  entries: LedgerEntry[];
  /** 1-based line numbers that could not be parsed and were skipped. */
  skippedLines: number[];
}

// Parses a decimal amount string into integer minor units with exact string
// math — no parseFloat ever touches the value. The digit string is split on
// '.', the fraction padded to the currency's minor-unit count, and the
// concatenated digits converted as an integer (exact up to 2^53). Lines with
// more precision than the currency carries are rejected rather than rounded.
export function parseDecimalToMinorUnits(
  raw: string,
  decimals: number
): MinorUnits | null {
  const cleaned = raw.trim().replaceAll(',', '');
  if (cleaned === '') return null;

  let sign = 1;
  let digits = cleaned;
  if (digits.startsWith('-')) {
    sign = -1;
    digits = digits.slice(1);
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  if (digits === '' || digits === '.' || !/^\d*(?:\.\d*)?$/.test(digits)) {
    return null;
  }

  const dotIndex = digits.indexOf('.');
  const intPart = dotIndex === -1 ? digits : digits.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : digits.slice(dotIndex + 1);
  if (fracPart.length > decimals) return null;

  const combined =
    (intPart === '' ? '0' : intPart) + fracPart.padEnd(decimals, '0');
  const value = Number(combined);
  if (!Number.isSafeInteger(value)) return null;
  return sign * value;
}

// Splits one CSV line into fields, honoring double-quoted fields with ""
// escapes. Degrades gracefully: an unterminated quote just runs to the end
// of the line.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEADER = ['date', 'payee', 'narration', 'account', 'amount', 'currency'];

// Parses a transactions CSV (columns: date,payee,narration,account,amount,
// currency — one posting per line) into LedgerEntry[]. Consecutive lines
// sharing (date, payee, narration) fold into one multi-posting entry, so a
// balanced journal round-trips naturally. Unparseable lines are skipped and
// reported by line number; unbalanced groups are kept as-is — the renderer
// flags them, the parser never repairs them.
export function parseCsvLedger(text: string): ParsedCsvLedger {
  const lines = text.split(/\r\n|\r|\n/);
  const entries: LedgerEntry[] = [];
  const skippedLines: number[] = [];

  let currentKey: string | null = null;
  let entryCounter = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.trim() === '') continue;

    const fields = splitCsvLine(line).map((field) => field.trim());
    // Skip a header row wherever it appears (usually line 1).
    if (
      fields.length >= HEADER.length &&
      HEADER.every((name, i) => fields[i].toLowerCase() === name)
    ) {
      continue;
    }
    if (fields.length < 6) {
      skippedLines.push(lineIndex + 1);
      continue;
    }

    const [date, payeeRaw, narration, account, amountRaw, currencyRaw] = fields;
    const currency = currencyRaw.toUpperCase();
    const amount = parseDecimalToMinorUnits(
      amountRaw,
      getCurrencyDecimals(currency)
    );
    if (
      !ISO_DATE.test(date) ||
      !isValidAccountPath(account) ||
      amount == null ||
      currency === ''
    ) {
      skippedLines.push(lineIndex + 1);
      continue;
    }

    const payee = payeeRaw === '' ? null : payeeRaw;
    const groupKey = `${date}\u0000${payeeRaw}\u0000${narration}`;
    const posting = { account, amount, currency };

    const last = entries[entries.length - 1];
    if (groupKey === currentKey && last != null) {
      entries[entries.length - 1] = {
        ...last,
        postings: [...last.postings, posting],
      };
    } else {
      entryCounter += 1;
      currentKey = groupKey;
      entries.push({
        id: `csv-${entryCounter}`,
        date,
        flag: 'cleared',
        payee,
        narration,
        tags: [],
        links: [],
        postings: [posting],
      });
    }
  }

  return { entries, skippedLines };
}
