import { describe, expect, test } from 'bun:test';

import { getCurrencyExponent } from '../src/currency';

describe('getCurrencyExponent', () => {
  test('common currencies default to 2', () => {
    expect(getCurrencyExponent('MYR')).toBe(2);
    expect(getCurrencyExponent('USD')).toBe(2);
    expect(getCurrencyExponent('EUR')).toBe(2);
  });

  test('zero- and three-decimal ISO exceptions are known', () => {
    expect(getCurrencyExponent('JPY')).toBe(0);
    expect(getCurrencyExponent('KRW')).toBe(0);
    expect(getCurrencyExponent('VND')).toBe(0);
    expect(getCurrencyExponent('BHD')).toBe(3);
    expect(getCurrencyExponent('KWD')).toBe(3);
    expect(getCurrencyExponent('TND')).toBe(3);
  });

  test('unknown codes and commodities degrade to 2', () => {
    expect(getCurrencyExponent('WIDGETS')).toBe(2);
    expect(getCurrencyExponent('')).toBe(2);
  });

  test('caller overrides win over the default table', () => {
    expect(getCurrencyExponent('BTC', { BTC: 8 })).toBe(8);
    expect(getCurrencyExponent('JPY', { JPY: 2 })).toBe(2);
  });

  test('malformed overrides are ignored, not propagated', () => {
    expect(getCurrencyExponent('XAU', { XAU: -1 })).toBe(2);
    expect(getCurrencyExponent('XAU', { XAU: 2.5 })).toBe(2);
    expect(getCurrencyExponent('XAU', { XAU: Number.NaN })).toBe(2);
    // A malformed override for a known exception falls back to 2, not the
    // table value — the caller explicitly took ownership of that code.
    expect(getCurrencyExponent('JPY', { JPY: Number.NaN })).toBe(2);
  });
});
