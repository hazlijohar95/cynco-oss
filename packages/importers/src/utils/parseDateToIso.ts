import { ImportError } from '../errors';
import type { CsvDateFormat } from '../types';

/** Days per month; February is patched for leap years below. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Field extraction patterns per declared format, capturing (1)(2)(3) in written order. */
const FORMAT_PATTERNS: Record<CsvDateFormat, RegExp> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/,
  'DD/MM/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/,
  'MM/DD/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/,
  'DD.MM.YYYY': /^(\d{2})\.(\d{2})\.(\d{4})$/,
};

/**
 * Parses a date string under an explicitly declared format to ISO
 * `YYYY-MM-DD`. Pure string reordering plus calendar validation — no `Date`
 * object is involved, so no timezone can shift an import across midnight.
 * Calendar validity is checked (month 1–12, day within month, leap years)
 * because `31/02/2026` reaching a ledger as a real date corrupts ordering
 * downstream. Throws `DATE_INVALID`; the CSV parser turns that into a
 * skipped row.
 */
export function parseDateToIso(text: string, format: CsvDateFormat): string {
  const match = FORMAT_PATTERNS[format].exec(text.trim());
  if (match == null) {
    throw new ImportError(
      'DATE_INVALID',
      `date ${JSON.stringify(text)} does not match ${format}`
    );
  }

  let year: string;
  let month: string;
  let day: string;
  if (format === 'YYYY-MM-DD') {
    [year, month, day] = [match[1], match[2], match[3]];
  } else if (format === 'MM/DD/YYYY') {
    [month, day, year] = [match[1], match[2], match[3]];
  } else {
    [day, month, year] = [match[1], match[2], match[3]];
  }

  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const maxDay =
    monthNumber === 2 && isLeapYear(Number(year))
      ? 29
      : (DAYS_IN_MONTH[monthNumber - 1] ?? 0);
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > maxDay
  ) {
    throw new ImportError(
      'DATE_INVALID',
      `date ${JSON.stringify(text)} is not a valid calendar date`
    );
  }
  return `${year}-${month}-${day}`;
}
