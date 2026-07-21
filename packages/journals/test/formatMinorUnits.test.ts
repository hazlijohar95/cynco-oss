import { describe, expect, test } from 'bun:test';

import { MINUS_SIGN } from '../src/constants';
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
