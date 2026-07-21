import { getCurrencyExponent } from '@cynco/ledger-core';

import { MINUS_SIGN } from '../constants';
import type { MinorUnits } from '../types';

export interface FormatMinorUnitsOptions {
  /**
   * Sign handling. `auto` (default) prefixes negatives with a proper minus
   * (U+2212); `always` also prefixes positives with `+`; `never` renders the
   * absolute value — used when a column carries the semantics instead.
   */
  sign?: 'auto' | 'always' | 'never';
}

// Formats integer minor units into a display string with thousands
// separators, e.g. formatMinorUnits(-4550, 'MYR') === '−45.50'. This is the
// house digit-string algorithm (the journals/accounts helper, kept
// behavior-identical): all math is done on the decimal digit string of the
// integer — no float division ever touches the value, so amounts are exact
// up to Number.MAX_SAFE_INTEGER. Decimal places come from the core currency
// registry (getCurrencyExponent) instead of a local table, so 0- and
// 3-decimal currencies scale exactly as the engine stores them.
export function formatMinorUnits(
  amount: MinorUnits,
  currency: string,
  options: FormatMinorUnitsOptions = {}
): string {
  const { sign = 'auto' } = options;
  const decimals = getCurrencyExponent(currency);
  const safeAmount = toSafeInteger(amount);
  const negative = safeAmount < 0;

  // Safe integers stringify exactly and without exponents, so slicing the
  // digit string is a lossless way to split integer and fractional parts.
  const digits = String(Math.abs(safeAmount));
  const integerDigits =
    digits.length > decimals ? digits.slice(0, digits.length - decimals) : '0';
  const fractionDigits =
    decimals > 0 ? digits.slice(-decimals).padStart(decimals, '0') : '';

  const grouped = groupThousands(integerDigits);
  const unsigned = decimals > 0 ? `${grouped}.${fractionDigits}` : grouped;

  if (sign === 'never') {
    return unsigned;
  }
  if (negative) {
    return `${MINUS_SIGN}${unsigned}`;
  }
  return sign === 'always' ? `+${unsigned}` : unsigned;
}

// Inserts a comma before every group of three digits counted from the right.
function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Monetary values must be integers; degrade gracefully on bad input instead
// of throwing mid-render: non-finite becomes 0, fractional input truncates
// toward zero, and magnitudes beyond MAX_SAFE_INTEGER clamp (they cannot be
// represented exactly anyway).
function toSafeInteger(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  const truncated = Math.trunc(amount);
  if (truncated > Number.MAX_SAFE_INTEGER) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (truncated < -Number.MAX_SAFE_INTEGER) {
    return -Number.MAX_SAFE_INTEGER;
  }
  return truncated;
}
