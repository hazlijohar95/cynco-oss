import { describe, expect, test } from 'bun:test';

import { toDraftEntries } from '../src/toDraftEntries';
import type { StatementLine } from '../src/types';

const LINES: StatementLine[] = [
  {
    id: '2026030201',
    date: '2026-03-02',
    description: 'POS PURCHASE COFFEE BEAN KLCC',
    amount: -4590,
    currency: 'MYR',
  },
  {
    id: '2026030502',
    date: '2026-03-05',
    description: 'SALARY MARCH',
    amount: 450_000,
    currency: 'MYR',
  },
  {
    id: 'zero',
    date: '2026-03-06',
    description: 'FEE REVERSAL NET ZERO',
    amount: 0,
    currency: 'MYR',
  },
];

const OPTIONS = {
  account: 'Assets:Current:Cash-Maybank',
  suspenseAccount: 'Equity:Suspense',
};

describe('toDraftEntries', () => {
  test('every entry balances: postings sum to exactly zero per currency', () => {
    for (const entry of toDraftEntries(LINES, OPTIONS)) {
      const sum = entry.postings.reduce(
        (total, posting) => total + posting.amount,
        0
      );
      expect(sum).toBe(0);
      expect(entry.postings).toHaveLength(2);
    }
  });

  test('bank posting carries the statement sign; suspense carries the negation', () => {
    const [entry] = toDraftEntries(LINES, OPTIONS);
    expect(entry.postings[0]).toEqual({
      account: 'Assets:Current:Cash-Maybank',
      amount: -4590,
      currency: 'MYR',
    });
    expect(entry.postings[1]).toEqual({
      account: 'Equity:Suspense',
      amount: 4590,
      currency: 'MYR',
    });
  });

  test('zero-amount lines never produce IEEE -0 on the counterposting', () => {
    const entries = toDraftEntries(LINES, OPTIONS);
    expect(Object.is(entries[2].postings[1].amount, -0)).toBe(false);
    expect(entries[2].postings[1].amount).toBe(0);
  });

  test('entries are pending drafts with the description as narration', () => {
    const [entry] = toDraftEntries(LINES, OPTIONS);
    expect(entry.flag).toBe('pending');
    expect(entry.payee).toBeNull();
    expect(entry.narration).toBe('POS PURCHASE COFFEE BEAN KLCC');
    expect(entry.tags).toEqual([]);
    expect(entry.links).toEqual([]);
    expect(entry.date).toBe('2026-03-02');
  });

  test('ids are deterministic across reruns: account-prefixed line ids', () => {
    const first = toDraftEntries(LINES, OPTIONS);
    const second = toDraftEntries(LINES, OPTIONS);
    expect(first.map((entry) => entry.id)).toEqual(
      second.map((entry) => entry.id)
    );
    expect(first[0].id).toBe('Assets:Current:Cash-Maybank:2026030201');
  });

  test('currency override rebooks both postings under the given code', () => {
    const [entry] = toDraftEntries(LINES, { ...OPTIONS, currency: 'USD' });
    expect(entry.postings.map((posting) => posting.currency)).toEqual([
      'USD',
      'USD',
    ]);
  });
});
