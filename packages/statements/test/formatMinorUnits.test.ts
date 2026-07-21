import { describe, expect, test } from 'bun:test';

import {
  AMOUNT_FORMAT_APOSTROPHE_DOT,
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  AMOUNT_FORMAT_INDIAN,
  AMOUNT_FORMAT_SPACE_COMMA,
  MINUS_SIGN,
} from '../src/constants';
import { formatMinorUnits } from '../src/utils/formatMinorUnits';

// Behavior-identical to the journals/accounts digit-string formatter, except
// decimal places resolve through the core currency registry
// (getCurrencyExponent) instead of a local table.
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

  test('0-decimal and 3-decimal currencies scale via the core registry', () => {
    // JPY minor units are whole yen; BHD minor units are fils (thousandths).
    expect(formatMinorUnits(1_500, 'JPY')).toBe('1,500');
    expect(formatMinorUnits(1_500, 'BHD')).toBe('1.500');
    // The registry covers more than the old local table did.
    expect(formatMinorUnits(1_500, 'VND')).toBe('1,500');
    expect(formatMinorUnits(1_500, 'TND')).toBe('1.500');
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

  // Preset × currency-exponent matrix, mirroring the journals/accounts
  // suites (the helpers are deliberate lockstep duplicates).
  test('amount format presets across 2/0/3-decimal currencies', () => {
    const cases: readonly [
      number,
      string,
      Parameters<typeof formatMinorUnits>[2],
      string,
    ][] = [
      [123_456_789, 'MYR', { format: AMOUNT_FORMAT_DOT_COMMA }, '1.234.567,89'],
      [
        123_456_789,
        'MYR',
        { format: AMOUNT_FORMAT_SPACE_COMMA },
        '1\u202f234\u202f567,89',
      ],
      [
        123_456_789,
        'MYR',
        { format: AMOUNT_FORMAT_APOSTROPHE_DOT },
        "1'234'567.89",
      ],
      [123_456_789, 'MYR', { format: AMOUNT_FORMAT_INDIAN }, '12,34,567.89'],
      [1_234_567, 'JPY', { format: AMOUNT_FORMAT_DOT_COMMA }, '1.234.567'],
      [
        1_234_567,
        'JPY',
        { format: AMOUNT_FORMAT_SPACE_COMMA },
        '1\u202f234\u202f567',
      ],
      [1_234_567, 'JPY', { format: AMOUNT_FORMAT_INDIAN }, '12,34,567'],
      [123_456_789, 'BHD', { format: AMOUNT_FORMAT_DOT_COMMA }, '123.456,789'],
      [
        123_456_789,
        'BHD',
        { format: AMOUNT_FORMAT_APOSTROPHE_DOT },
        "123'456.789",
      ],
      [123_456_789, 'BHD', { format: AMOUNT_FORMAT_INDIAN }, '1,23,456.789'],
    ];
    for (const [amount, currency, options, expected] of cases) {
      expect(formatMinorUnits(amount, currency, options)).toBe(expected);
    }
  });

  test('amount format presets: negatives keep U+2212 and sign options compose', () => {
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
