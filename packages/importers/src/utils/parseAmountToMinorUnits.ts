import { getCurrencyDecimals } from '../constants';
import { ImportError } from '../errors';
import type { CsvAmountFormat, MinorUnits } from '../types';

/**
 * Parses a decimal amount string straight to integer minor units — the string
 * never passes through a float (`"1,234.56"` becomes the integer `123456`,
 * never `1234.56`), so amounts stay exact at any magnitude a bank can export.
 *
 * The currency's exponent bounds the fraction: fewer digits are zero-padded
 * (banks print `12.5` for 12.50), MORE digits throw `AMOUNT_DECIMALS` — a
 * sub-minor-unit amount cannot be represented without rounding, and importers
 * never round money. Throws `AMOUNT_INVALID` for anything that is not a
 * plain signed decimal after group separators are stripped; callers decide
 * whether that skips the row or aborts the file.
 */
export function parseAmountToMinorUnits(
  text: string,
  format: CsvAmountFormat,
  currency: string
): MinorUnits {
  const decimals = getCurrencyDecimals(currency);
  let cleaned = text.trim();
  if (format.group !== undefined && format.group !== '') {
    cleaned = cleaned.split(format.group).join('');
  }
  if (cleaned === '') {
    throw new ImportError('AMOUNT_INVALID', 'empty amount');
  }

  let sign = 1;
  if (cleaned.startsWith('-')) {
    sign = -1;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  const parts = cleaned.split(format.decimal);
  if (parts.length > 2) {
    throw new ImportError(
      'AMOUNT_INVALID',
      `amount ${JSON.stringify(text)} has multiple ${JSON.stringify(format.decimal)} separators`
    );
  }
  const whole = parts[0] ?? '';
  const fraction = parts[1] ?? '';
  if (!/^\d+$/.test(whole) || (parts.length === 2 && !/^\d+$/.test(fraction))) {
    throw new ImportError(
      'AMOUNT_INVALID',
      `amount ${JSON.stringify(text)} is not a plain decimal number`
    );
  }
  if (fraction.length > decimals) {
    throw new ImportError(
      'AMOUNT_DECIMALS',
      `amount ${JSON.stringify(text)} has ${fraction.length} decimal places but ${currency} allows ${decimals}`
    );
  }

  const minor = Number(whole + fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(minor)) {
    throw new ImportError(
      'AMOUNT_OVERFLOW',
      `amount ${JSON.stringify(text)} exceeds the safe integer range in minor units`
    );
  }
  // 0 - 0 is +0, so a "-0.00" input can never leak IEEE -0 out of a parser.
  return sign === -1 ? 0 - minor : minor;
}
