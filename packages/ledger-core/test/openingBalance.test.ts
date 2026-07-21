import { describe, expect, test } from 'bun:test';

import { isEntryBalanced } from '../src/money';
import {
  createOpeningBalanceEntry,
  DEFAULT_OPENING_BALANCE_ACCOUNT,
} from '../src/openingBalance';

describe('createOpeningBalanceEntry', () => {
  test('builds a balanced entry with one equity offset per currency', () => {
    const entry = createOpeningBalanceEntry({
      id: 'open-1',
      date: '2025-01-01',
      lines: [
        { account: 'Assets:Cash', amount: 50_000, currency: 'MYR' },
        { account: 'Assets:Bank:Maybank', amount: 120_000, currency: 'MYR' },
        { account: 'Liabilities:Loan', amount: -80_000, currency: 'MYR' },
        { account: 'Assets:Bank:Wise', amount: 900, currency: 'USD' },
      ],
    });
    expect(isEntryBalanced(entry)).toBe(true);
    const offsets = entry.postings.filter(
      (posting) => posting.account === DEFAULT_OPENING_BALANCE_ACCOUNT
    );
    expect(offsets).toEqual([
      {
        account: DEFAULT_OPENING_BALANCE_ACCOUNT,
        amount: -90_000,
        currency: 'MYR',
      },
      {
        account: DEFAULT_OPENING_BALANCE_ACCOUNT,
        amount: -900,
        currency: 'USD',
      },
    ]);
  });

  test('lines already netting to zero get no equity offset', () => {
    const entry = createOpeningBalanceEntry({
      id: 'open-2',
      date: '2025-01-01',
      lines: [
        { account: 'Assets:Cash', amount: 1_000, currency: 'MYR' },
        { account: 'Liabilities:Loan', amount: -1_000, currency: 'MYR' },
      ],
    });
    expect(entry.postings).toHaveLength(2);
    expect(isEntryBalanced(entry)).toBe(true);
  });

  test('defaults: cleared flag, standard narration, empty tags and links', () => {
    const entry = createOpeningBalanceEntry({
      id: 'open-3',
      date: '2025-01-01',
      lines: [{ account: 'Assets:Cash', amount: 100, currency: 'MYR' }],
    });
    expect(entry.flag).toBe('cleared');
    expect(entry.narration).toBe('Opening balances');
    expect(entry.payee).toBeNull();
    expect(entry.tags).toEqual([]);
    expect(entry.links).toEqual([]);
  });

  test('custom equity account and metadata are honored', () => {
    const entry = createOpeningBalanceEntry({
      id: 'open-4',
      date: '2025-07-01',
      lines: [{ account: 'Assets:Cash', amount: 100, currency: 'MYR' }],
      equityAccount: 'Equity:Migration',
      flag: 'pending',
      narration: 'FY2026 migration',
      tags: ['migration'],
      links: ['batch-7'],
    });
    expect(entry.postings[1].account).toBe('Equity:Migration');
    expect(entry.flag).toBe('pending');
    expect(entry.narration).toBe('FY2026 migration');
    expect(entry.tags).toEqual(['migration']);
    expect(entry.links).toEqual(['batch-7']);
  });

  test('throws on non-integer amounts (programmer-error boundary)', () => {
    expect(() =>
      createOpeningBalanceEntry({
        id: 'open-5',
        date: '2025-01-01',
        lines: [{ account: 'Assets:Cash', amount: 100.5, currency: 'MYR' }],
      })
    ).toThrow(TypeError);
  });

  test('throws on invalid account paths instead of dropping lines', () => {
    expect(() =>
      createOpeningBalanceEntry({
        id: 'open-6',
        date: '2025-01-01',
        lines: [{ account: 'Assets::Cash', amount: 100, currency: 'MYR' }],
      })
    ).toThrow(TypeError);
    expect(() =>
      createOpeningBalanceEntry({
        id: 'open-7',
        date: '2025-01-01',
        lines: [{ account: 'Assets:Cash', amount: 100, currency: 'MYR' }],
        equityAccount: ':bad',
      })
    ).toThrow(TypeError);
  });
});
