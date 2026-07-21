import { describe, expect, test } from 'bun:test';

import {
  AMOUNT_FORMAT_APOSTROPHE_DOT,
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  AMOUNT_FORMAT_INDIAN,
  AMOUNT_FORMAT_SPACE_COMMA,
  MINUS_SIGN,
} from '../src/constants';
import {
  formatMinorUnits,
  getCurrencyDecimals,
} from '../src/utils/formatMinorUnits';

describe('getCurrencyDecimals', () => {
  test('defaults to 2 for unknown codes and commodities', () => {
    expect(getCurrencyDecimals('MYR')).toBe(2);
    expect(getCurrencyDecimals('USD')).toBe(2);
    expect(getCurrencyDecimals('VTI')).toBe(2);
  });

  test('0-decimal and 3-decimal exceptions', () => {
    expect(getCurrencyDecimals('JPY')).toBe(0);
    expect(getCurrencyDecimals('KRW')).toBe(0);
    expect(getCurrencyDecimals('BHD')).toBe(3);
    expect(getCurrencyDecimals('KWD')).toBe(3);
    expect(getCurrencyDecimals('OMR')).toBe(3);
  });

  // The table once drifted to a 5-entry subset of the engine's canonical
  // exponents, mis-scaling these currencies 100×/10× relative to
  // @cynco/statements. Locks the full mirror in place.
  test('matches the engine table beyond the common exceptions', () => {
    expect(getCurrencyDecimals('VND')).toBe(0);
    expect(getCurrencyDecimals('CLP')).toBe(0);
    expect(getCurrencyDecimals('ISK')).toBe(0);
    expect(getCurrencyDecimals('XOF')).toBe(0);
    expect(getCurrencyDecimals('IQD')).toBe(3);
    expect(getCurrencyDecimals('JOD')).toBe(3);
    expect(getCurrencyDecimals('TND')).toBe(3);
    expect(getCurrencyDecimals('CLF')).toBe(4);
    expect(formatMinorUnits(1234, 'VND')).toBe('1,234');
    expect(formatMinorUnits(1234, 'IQD')).toBe('1.234');
  });
});

describe('formatMinorUnits', () => {
  test('zero', () => {
    expect(formatMinorUnits(0, 'MYR')).toBe('0.00');
    expect(formatMinorUnits(0, 'JPY')).toBe('0');
    expect(formatMinorUnits(0, 'BHD')).toBe('0.000');
  });

  test('sub-unit amounts pad the fraction', () => {
    expect(formatMinorUnits(5, 'MYR')).toBe('0.05');
    expect(formatMinorUnits(45, 'MYR')).toBe('0.45');
    expect(formatMinorUnits(7, 'KWD')).toBe('0.007');
  });

  test('thousands separators', () => {
    expect(formatMinorUnits(100_000, 'MYR')).toBe('1,000.00');
    expect(formatMinorUnits(123_456_789, 'MYR')).toBe('1,234,567.89');
    expect(formatMinorUnits(1_000_000, 'JPY')).toBe('1,000,000');
    expect(formatMinorUnits(1_234_567, 'BHD')).toBe('1,234.567');
  });

  test('negative amounts use a proper minus (U+2212)', () => {
    expect(formatMinorUnits(-4_550, 'MYR')).toBe(`${MINUS_SIGN}45.50`);
    expect(formatMinorUnits(-4_550, 'MYR')).not.toContain('-');
    expect(formatMinorUnits(-1_500, 'JPY')).toBe(`${MINUS_SIGN}1,500`);
  });

  test('sign option: always', () => {
    expect(formatMinorUnits(150, 'MYR', { sign: 'always' })).toBe('+1.50');
    expect(formatMinorUnits(-150, 'MYR', { sign: 'always' })).toBe(
      `${MINUS_SIGN}1.50`
    );
    expect(formatMinorUnits(0, 'MYR', { sign: 'always' })).toBe('+0.00');
  });

  test('sign option: never renders the absolute value', () => {
    expect(formatMinorUnits(-4_550, 'MYR', { sign: 'never' })).toBe('45.50');
    expect(formatMinorUnits(4_550, 'MYR', { sign: 'never' })).toBe('45.50');
  });

  test('MAX_SAFE_INTEGER boundary stays exact', () => {
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, 'MYR')).toBe(
      '90,071,992,547,409.91'
    );
    expect(formatMinorUnits(-Number.MAX_SAFE_INTEGER, 'MYR')).toBe(
      `${MINUS_SIGN}90,071,992,547,409.91`
    );
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, 'JPY')).toBe(
      '9,007,199,254,740,991'
    );
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, 'BHD')).toBe(
      '9,007,199,254,740.991'
    );
  });

  // Each preset × representative currency exponents (2/0/3-decimal). The
  // values cross several group boundaries so the grouping itself — not just
  // the separators — is exercised.
  test('amount format presets: 2-decimal currency across multiple groups', () => {
    const amount = 123_456_789; // 1,234,567.89 MYR
    expect(formatMinorUnits(amount, 'MYR')).toBe('1,234,567.89');
    expect(
      formatMinorUnits(amount, 'MYR', { format: AMOUNT_FORMAT_DOT_COMMA })
    ).toBe('1.234.567,89');
    expect(
      formatMinorUnits(amount, 'MYR', { format: AMOUNT_FORMAT_SPACE_COMMA })
    ).toBe('1\u202f234\u202f567,89');
    expect(
      formatMinorUnits(amount, 'MYR', { format: AMOUNT_FORMAT_APOSTROPHE_DOT })
    ).toBe("1'234'567.89");
    expect(
      formatMinorUnits(amount, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('12,34,567.89');
  });

  test('amount format presets: 0-decimal currency (JPY)', () => {
    const amount = 1_234_567;
    expect(formatMinorUnits(amount, 'JPY')).toBe('1,234,567');
    expect(
      formatMinorUnits(amount, 'JPY', { format: AMOUNT_FORMAT_DOT_COMMA })
    ).toBe('1.234.567');
    expect(
      formatMinorUnits(amount, 'JPY', { format: AMOUNT_FORMAT_SPACE_COMMA })
    ).toBe('1\u202f234\u202f567');
    expect(
      formatMinorUnits(amount, 'JPY', { format: AMOUNT_FORMAT_APOSTROPHE_DOT })
    ).toBe("1'234'567");
    expect(
      formatMinorUnits(amount, 'JPY', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('12,34,567');
  });

  test('amount format presets: 3-decimal currency (BHD)', () => {
    const amount = 123_456_789; // 123,456.789 BHD
    expect(formatMinorUnits(amount, 'BHD')).toBe('123,456.789');
    expect(
      formatMinorUnits(amount, 'BHD', { format: AMOUNT_FORMAT_DOT_COMMA })
    ).toBe('123.456,789');
    expect(
      formatMinorUnits(amount, 'BHD', { format: AMOUNT_FORMAT_SPACE_COMMA })
    ).toBe('123\u202f456,789');
    expect(
      formatMinorUnits(amount, 'BHD', { format: AMOUNT_FORMAT_APOSTROPHE_DOT })
    ).toBe("123'456.789");
    expect(
      formatMinorUnits(amount, 'BHD', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,23,456.789');
  });

  test('amount format presets: negatives keep the U+2212 minus and sign options compose', () => {
    expect(
      formatMinorUnits(-123_456_789, 'MYR', { format: AMOUNT_FORMAT_DOT_COMMA })
    ).toBe(`${MINUS_SIGN}1.234.567,89`);
    expect(
      formatMinorUnits(-123_456_789, 'MYR', {
        sign: 'never',
        format: AMOUNT_FORMAT_SPACE_COMMA,
      })
    ).toBe('1\u202f234\u202f567,89');
    expect(
      formatMinorUnits(123_456_789, 'MYR', {
        sign: 'always',
        format: AMOUNT_FORMAT_INDIAN,
      })
    ).toBe('+12,34,567.89');
  });

  test('Indian grouping across lakh and crore boundaries', () => {
    // Below one lakh the Indian and Western groupings coincide.
    expect(
      formatMinorUnits(123_456, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,234.56');
    // One lakh (1,00,000) and one crore (1,00,00,000).
    expect(
      formatMinorUnits(10_000_000, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,00,000.00');
    expect(
      formatMinorUnits(1_000_000_000, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,00,00,000.00');
    expect(
      formatMinorUnits(1_234_567_890, 'JPY', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,23,45,67,890');
    // Very large values keep repeating the two-digit group exactly.
    expect(
      formatMinorUnits(Number.MAX_SAFE_INTEGER, 'MYR', {
        format: AMOUNT_FORMAT_INDIAN,
      })
    ).toBe('9,00,71,99,25,47,409.91');
  });

  test('explicit default preset is byte-identical to omitting the format', () => {
    for (const [amount, currency] of [
      [123_456_789, 'MYR'],
      [-4_550, 'MYR'],
      [1_000_000, 'JPY'],
      [1_234_567, 'BHD'],
      [0, 'MYR'],
      [Number.MAX_SAFE_INTEGER, 'MYR'],
    ] as const) {
      expect(
        formatMinorUnits(amount, currency, { format: AMOUNT_FORMAT_COMMA_DOT })
      ).toBe(formatMinorUnits(amount, currency));
    }
  });

  test('grouping-free descriptor renders no separators', () => {
    expect(
      formatMinorUnits(123_456_789, 'MYR', {
        format: { decimal: ',', group: '', groupSizes: [] },
      })
    ).toBe('1234567,89');
  });

  test('degrades gracefully on bad input instead of throwing', () => {
    expect(formatMinorUnits(Number.NaN, 'MYR')).toBe('0.00');
    expect(formatMinorUnits(Number.POSITIVE_INFINITY, 'MYR')).toBe('0.00');
    // Fractional minor units are invalid input; truncate toward zero.
    expect(formatMinorUnits(10.7, 'MYR')).toBe('0.10');
    expect(formatMinorUnits(-10.7, 'MYR')).toBe(`${MINUS_SIGN}0.10`);
    // Beyond-safe magnitudes clamp to the largest exact value.
    expect(formatMinorUnits(2 ** 54, 'MYR')).toBe('90,071,992,547,409.91');
  });
});
