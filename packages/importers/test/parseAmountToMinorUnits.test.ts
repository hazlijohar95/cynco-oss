import { describe, expect, test } from 'bun:test';

import { ImportError } from '../src/errors';
import { parseAmountToMinorUnits } from '../src/utils/parseAmountToMinorUnits';
import { parseDateToIso } from '../src/utils/parseDateToIso';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
  throw new Error('expected an ImportError');
}

describe('parseAmountToMinorUnits', () => {
  test('string-to-integer with no float in between', () => {
    expect(
      parseAmountToMinorUnits('1,234.56', { decimal: '.', group: ',' }, 'MYR')
    ).toBe(123_456);
    expect(parseAmountToMinorUnits('+12.00', { decimal: '.' }, 'MYR')).toBe(
      1200
    );
    expect(parseAmountToMinorUnits('-0.01', { decimal: '.' }, 'MYR')).toBe(-1);
  });

  test('four-decimal funds codes scale to 4 places', () => {
    expect(parseAmountToMinorUnits('1.2345', { decimal: '.' }, 'CLF')).toBe(
      12_345
    );
    expect(
      codeOf(() => parseAmountToMinorUnits('1.23456', { decimal: '.' }, 'CLF'))
    ).toBe('AMOUNT_DECIMALS');
  });

  test('negative zero normalizes to +0', () => {
    expect(
      Object.is(parseAmountToMinorUnits('-0.00', { decimal: '.' }, 'MYR'), -0)
    ).toBe(false);
  });

  test('typed rejections: garbage, double separators, overflow', () => {
    expect(
      codeOf(() => parseAmountToMinorUnits('12a.00', { decimal: '.' }, 'MYR'))
    ).toBe('AMOUNT_INVALID');
    expect(
      codeOf(() => parseAmountToMinorUnits('1.2.3', { decimal: '.' }, 'MYR'))
    ).toBe('AMOUNT_INVALID');
    expect(
      codeOf(() => parseAmountToMinorUnits('', { decimal: '.' }, 'MYR'))
    ).toBe('AMOUNT_INVALID');
    expect(
      codeOf(() =>
        parseAmountToMinorUnits('99999999999999999.00', { decimal: '.' }, 'MYR')
      )
    ).toBe('AMOUNT_OVERFLOW');
  });
});

describe('parseDateToIso', () => {
  test('reorders without ever touching a Date object', () => {
    expect(parseDateToIso('31/12/2026', 'DD/MM/YYYY')).toBe('2026-12-31');
    expect(parseDateToIso('12/31/2026', 'MM/DD/YYYY')).toBe('2026-12-31');
    expect(parseDateToIso('29.02.2028', 'DD.MM.YYYY')).toBe('2028-02-29');
  });

  test('rejects calendar impossibilities, including fake leap days', () => {
    expect(codeOf(() => parseDateToIso('29/02/2026', 'DD/MM/YYYY'))).toBe(
      'DATE_INVALID'
    );
    expect(codeOf(() => parseDateToIso('31/04/2026', 'DD/MM/YYYY'))).toBe(
      'DATE_INVALID'
    );
    expect(codeOf(() => parseDateToIso('00/01/2026', 'DD/MM/YYYY'))).toBe(
      'DATE_INVALID'
    );
    expect(codeOf(() => parseDateToIso('2026-3-1', 'YYYY-MM-DD'))).toBe(
      'DATE_INVALID'
    );
  });
});
