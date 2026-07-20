// The boundary adapter between @cynco/ledger-core's register rows (own-currency
// running balance as a plain number) and the renderer's RegisterRowData
// (per-currency map). This test pins the seam so a shape drift on either side
// fails here rather than as a runtime error inside the renderer.

import { describe, expect, test } from 'bun:test';

import type { LedgerEntry } from '../src/types';
import {
  type LedgerCoreRegisterRow,
  toRegisterRowData,
} from '../src/utils/toRegisterRowData';

function makeEntry(): LedgerEntry {
  return {
    id: 'e1',
    date: '2025-01-01',
    flag: 'cleared',
    payee: 'Acme',
    narration: '',
    tags: [],
    links: [],
    postings: [
      { account: 'Assets:Cash', amount: 10_000, currency: 'MYR' },
      { account: 'Income:Sales', amount: -10_000, currency: 'MYR' },
    ],
  };
}

describe('toRegisterRowData', () => {
  test('wraps the own-currency balance in a map keyed by the posting currency', () => {
    const entry = makeEntry();
    const coreRow: LedgerCoreRegisterRow = {
      entry,
      posting: entry.postings[0],
      runningBalance: 10_000,
    };
    const rowData = toRegisterRowData(coreRow);
    expect(rowData.entry).toBe(entry);
    expect(rowData.posting).toBe(entry.postings[0]);
    // The renderer reads exactly this: runningBalance.get(posting.currency).
    expect(rowData.runningBalance.get('MYR')).toBe(10_000);
    // No phantom currencies leak in.
    expect(rowData.runningBalance.size).toBe(1);
  });

  test('preserves negative balances and non-MYR currencies', () => {
    const entry = makeEntry();
    const usdPosting = { account: 'Assets:USD', amount: -500, currency: 'USD' };
    const rowData = toRegisterRowData({
      entry,
      posting: usdPosting,
      runningBalance: -12_345,
    });
    expect(rowData.runningBalance.get('USD')).toBe(-12_345);
    expect(rowData.runningBalance.get('MYR')).toBeUndefined();
  });
});
