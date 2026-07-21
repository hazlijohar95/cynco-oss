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

// Mirrors the journals/statements suites (the helpers are deliberate
// lockstep duplicates); if these expectations ever diverge across the three
// packages the copies have drifted.
describe('formatMinorUnits', () => {
  test('defaults stay the original bytes', () => {
    expect(formatMinorUnits(123_456_789, 'MYR')).toBe('1,234,567.89');
    expect(formatMinorUnits(0, 'MYR')).toBe('0.00');
    expect(formatMinorUnits(1_000_000, 'JPY')).toBe('1,000,000');
    expect(formatMinorUnits(1_234_567, 'BHD')).toBe('1,234.567');
    expect(formatMinorUnits(-4_550, 'MYR')).toBe(`${MINUS_SIGN}45.50`);
    expect(getCurrencyDecimals('JPY')).toBe(0);
    expect(getCurrencyDecimals('BHD')).toBe(3);
  });

  test('amount format presets: 2-decimal currency across multiple groups', () => {
    const amount = 123_456_789; // 1,234,567.89 MYR
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

  test('negatives keep the U+2212 minus and sign options compose', () => {
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
    expect(
      formatMinorUnits(123_456, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,234.56');
    expect(
      formatMinorUnits(10_000_000, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,00,000.00');
    expect(
      formatMinorUnits(1_000_000_000, 'MYR', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,00,00,000.00');
    expect(
      formatMinorUnits(1_234_567_890, 'JPY', { format: AMOUNT_FORMAT_INDIAN })
    ).toBe('1,23,45,67,890');
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
});
