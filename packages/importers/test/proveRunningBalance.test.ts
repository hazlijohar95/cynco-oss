import { describe, expect, test } from 'bun:test';

import { ImportError } from '../src/errors';
import { proveRunningBalance } from '../src/proveRunningBalance';
import type { ImportedStatementLine } from '../src/types';

function line(
  id: string,
  amount: number,
  balance?: number
): ImportedStatementLine {
  return {
    id,
    date: '2026-03-01',
    description: id,
    amount,
    currency: 'MYR',
    ...(balance === undefined ? {} : { balance }),
  };
}

describe('proveRunningBalance', () => {
  test('empty input is trivially proven', () => {
    expect(proveRunningBalance([])).toEqual({ ok: true });
  });

  test('proof passes with an explicit opening balance', () => {
    const lines = [
      line('a', -1000, 99_000),
      line('b', 5000, 104_000),
      line('c', -4000, 100_000),
    ];
    expect(proveRunningBalance(lines, 100_000)).toEqual({ ok: true });
  });

  test('proof passes anchoring the opening off the first line', () => {
    const lines = [line('a', -1000, 99_000), line('b', 5000, 104_000)];
    expect(proveRunningBalance(lines)).toEqual({ ok: true });
  });

  test('a wrong opening is caught on the very first line', () => {
    const result = proveRunningBalance([line('a', -1000, 99_000)], 50_000);
    expect(result).toEqual({
      ok: false,
      breaks: [{ index: 0, expected: 49_000, actual: 99_000 }],
    });
  });

  test('a break reports its exact location and does not cascade', () => {
    const lines = [
      line('a', -1000, 99_000),
      // A missing transaction: the bank says 97_500 but our sum says 98_500.
      line('b', -500, 97_500),
      // Consistent again from the claimed balance onward.
      line('c', 1000, 98_500),
    ];
    const result = proveRunningBalance(lines, 100_000);
    expect(result).toEqual({
      ok: false,
      breaks: [{ index: 1, expected: 98_500, actual: 97_500 }],
    });
  });

  test('a line without a balance throws BALANCE_MISSING, never guesses', () => {
    let caught: unknown;
    try {
      proveRunningBalance([line('a', -1000, 99_000), line('b', 5000)]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).code).toBe('BALANCE_MISSING');
  });
});
