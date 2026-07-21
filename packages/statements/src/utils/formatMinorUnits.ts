import { getCurrencyExponent } from '@cynco/ledger-core';

import { AMOUNT_FORMAT_COMMA_DOT, MINUS_SIGN } from '../constants';
import type { AmountFormat, MinorUnits } from '../types';

export interface FormatMinorUnitsOptions {
  /**
   * Sign handling. `auto` (default) prefixes negatives with a proper minus
   * (U+2212); `always` also prefixes positives with `+`; `never` renders the
   * absolute value — used when a column carries the semantics instead.
   */
  sign?: 'auto' | 'always' | 'never';
  /**
   * Separator and grouping descriptor (see {@link AmountFormat}). Defaults
   * to AMOUNT_FORMAT_COMMA_DOT — the package's original `1,234.56` bytes —
   * so callers that never pass it see zero output change. Affects ONLY the
   * group/decimal separators and digit grouping: sign conventions (U+2212,
   * debit/credit columns) and per-currency decimal counts compose on top
   * unchanged.
   */
  format?: AmountFormat;
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
  const { sign = 'auto', format = AMOUNT_FORMAT_COMMA_DOT } = options;
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

  const grouped = groupIntegerDigits(integerDigits, format);
  const unsigned =
    decimals > 0 ? `${grouped}${format.decimal}${fractionDigits}` : grouped;

  if (sign === 'never') {
    return unsigned;
  }
  if (negative) {
    return `${MINUS_SIGN}${unsigned}`;
  }
  return sign === 'always' ? `+${unsigned}` : unsigned;
}

// Groups integer digits from the decimal point outward per the descriptor:
// each entry of groupSizes consumes that many digits right-to-left and the
// LAST size repeats for whatever remains, so [3] is Western thousands and
// [3,2] is Indian lakh/crore. Pure slicing over the digit string — the
// deterministic stand-in for Intl.NumberFormat, which must never run in a
// render path (ICU versions differ between Node and browsers, which would
// break the server/client byte-parity contract).
function groupIntegerDigits(
  integerDigits: string,
  format: AmountFormat
): string {
  const { group, groupSizes } = format;
  if (group === '' || groupSizes.length === 0) {
    return integerDigits;
  }
  const parts: string[] = [];
  let end = integerDigits.length;
  let sizeIndex = 0;
  while (end > 0) {
    const size = groupSizes[Math.min(sizeIndex, groupSizes.length - 1)];
    // A non-positive size is a malformed descriptor; keep the remaining
    // digits ungrouped rather than looping forever — degrade gracefully
    // mid-render, never throw or hang.
    if (!Number.isInteger(size) || size <= 0) {
      parts.unshift(integerDigits.slice(0, end));
      break;
    }
    parts.unshift(integerDigits.slice(Math.max(0, end - size), end));
    end -= size;
    sizeIndex += 1;
  }
  return parts.join(group);
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
