import { describe, expect, test } from 'bun:test';

import { EntryStore } from '../src/EntryStore';
import type { LedgerEntry } from '../src/types';

// Pins the merge-insert invariant in addEntries: incremental adds must leave
// the entry list in exactly (date, id) order — identical to a single
// sorted insert of the same entries — no matter what order the batches
// arrive in. addEntries merges each sorted batch into the already-sorted
// list rather than re-sorting the whole list; this suite is the guard that
// the merge stays a correct, stable sort under adversarial batching.

function makeEntry(id: string, date: string): LedgerEntry {
  return {
    id,
    date,
    flag: 'cleared',
    payee: null,
    narration: '',
    tags: [],
    links: [],
    postings: [
      { account: 'Assets:Cash', amount: 100, currency: 'MYR' },
      { account: 'Income:Sales', amount: -100, currency: 'MYR' },
    ],
  };
}

// A spread of entries whose (date, id) order is deliberately unrelated to
// insertion order: dates jump around and ids do not increase with date.
function scrambledEntries(count: number): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const month = 1 + ((index * 7) % 12);
    const day = 1 + ((index * 13) % 28);
    const date = `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // id salted so equal dates still get a total, non-insertion order.
    const id = `e${String((index * 9973) % 100000).padStart(5, '0')}-${index}`;
    entries.push(makeEntry(id, date));
  }
  return entries;
}

function orderKey(entries: readonly LedgerEntry[]): string[] {
  return entries.map((entry) => `${entry.date}#${entry.id}`);
}

function fullySorted(entries: readonly LedgerEntry[]): string[] {
  return orderKey(
    [...entries].sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0
    )
  );
}

describe('EntryStore ordering under incremental adds', () => {
  test('many small out-of-order batches produce the same order as one sort', () => {
    const entries = scrambledEntries(2000);
    const expected = fullySorted(entries);

    const store = new EntryStore();
    // Feed the store in 40 chunks of 50, each chunk internally scrambled.
    for (let start = 0; start < entries.length; start += 50) {
      store.addEntries(entries.slice(start, start + 50));
    }

    const actual = orderKey(store.getEntrySlice(0, store.getEntryCount()));
    expect(actual).toEqual(expected);
  });

  test('interleaving late-dated and early-dated batches stays ordered', () => {
    const store = new EntryStore();
    // A batch far in the future first, then one in the past, then the middle.
    store.addEntries([
      makeEntry('b', '2025-12-31'),
      makeEntry('a', '2025-12-31'),
    ]);
    store.addEntries([
      makeEntry('z', '2025-01-01'),
      makeEntry('y', '2025-01-01'),
    ]);
    store.addEntries([makeEntry('m', '2025-06-15')]);

    const actual = orderKey(store.getEntrySlice(0, store.getEntryCount()));
    expect(actual).toEqual([
      '2025-01-01#y',
      '2025-01-01#z',
      '2025-06-15#m',
      '2025-12-31#a',
      '2025-12-31#b',
    ]);
  });

  test('a single bulk add equals the constructor for the same entries', () => {
    const entries = scrambledEntries(500);
    const built = new EntryStore(entries);
    const added = new EntryStore();
    added.addEntries(entries);
    expect(orderKey(added.getEntrySlice(0, added.getEntryCount()))).toEqual(
      orderKey(built.getEntrySlice(0, built.getEntryCount()))
    );
  });
});
