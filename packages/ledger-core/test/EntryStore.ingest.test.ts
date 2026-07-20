import { describe, expect, test } from 'bun:test';

import { EntryStore } from '../src/EntryStore';
import { createCooperativeScheduler } from '../src/scheduler';
import type { LedgerEntry, RegisterRow } from '../src/types';

// Deterministic fixture: balanced two-posting entries over a small account
// set, in shuffled date order, with some duplicate ids sprinkled in so the
// dedupe accounting is observable.
function generateEntries(count: number): LedgerEntry[] {
  const accounts = [
    'Assets:Cash',
    'Assets:Bank:Maybank',
    'Expenses:Food',
    'Income:Sales',
  ];
  const entries: LedgerEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const amount = 100 + ((index * 37) % 900);
    const debit = accounts[index % accounts.length];
    const credit = accounts[(index + 1) % accounts.length];
    entries.push({
      id: `e${String((index * 7919) % count).padStart(6, '0')}-${index}`,
      date: `2025-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
      flag: 'cleared',
      payee: `Payee ${index % 11}`,
      narration: `ingest fixture ${index}`,
      tags: [],
      links: [],
      postings: [
        { account: debit, amount, currency: 'MYR' },
        { account: credit, amount: -amount, currency: 'MYR' },
      ],
    });
  }
  return entries;
}

function projectRegister(rows: readonly RegisterRow[]): string[] {
  return rows.map(
    (row) =>
      `${row.entry.date} ${row.entry.id} ${row.posting.amount}${row.posting.currency} run=${row.runningBalance}`
  );
}

// Every public read the equivalence tests compare: entry order, register
// slices (cached prefix sums), and running balances for each account.
function snapshotStore(store: EntryStore): string[] {
  const snapshot: string[] = [
    `count=${store.getEntryCount()}`,
    ...store.getEntrySlice(0, store.getEntryCount()).map((entry) => entry.id),
  ];
  for (const account of ['Assets:Cash', 'Assets:Bank:Maybank', 'Assets']) {
    snapshot.push(
      `rows:${account}=${store.getRegisterRowCount(account, { includeDescendants: true })}`
    );
    snapshot.push(
      ...projectRegister(
        store.getRegisterRows(account, {
          start: 0,
          end: 50,
          includeDescendants: true,
        })
      )
    );
  }
  return snapshot;
}

describe('EntryStore.addEntriesAsync', () => {
  test('is exactly equivalent to one synchronous addEntries of the same data', async () => {
    const entries = generateEntries(1200);
    const withDuplicates = [...entries, ...entries.slice(0, 150)];

    const syncStore = new EntryStore();
    syncStore.addEntries(withDuplicates);

    const asyncStore = new EntryStore();
    const result = await asyncStore.addEntriesAsync(withDuplicates, {
      chunkSize: 100,
    });

    expect(result).toEqual({ added: 1200, skipped: 150, aborted: false });
    expect(snapshotStore(asyncStore)).toEqual(snapshotStore(syncStore));
  });

  test('ingests from an async generator source', async () => {
    const entries = generateEntries(500);
    async function* source(): AsyncGenerator<LedgerEntry, void, void> {
      for (const entry of entries) {
        // Hop a microtask per entry so the async-iterable path is exercised
        // with genuinely asynchronous arrival, not a sync loop in disguise.
        await Promise.resolve();
        yield entry;
      }
    }
    const store = new EntryStore();
    const result = await store.addEntriesAsync(source(), { chunkSize: 64 });
    expect(result).toEqual({ added: 500, skipped: 0, aborted: false });
    const reference = new EntryStore(entries);
    expect(snapshotStore(store)).toEqual(snapshotStore(reference));
  });

  test('runs chunks as scheduler tasks when a scheduler is provided', async () => {
    const entries = generateEntries(500);
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    const store = new EntryStore();
    const result = await store.addEntriesAsync(entries, {
      scheduler,
      chunkSize: 100,
    });
    expect(result.added).toBe(500);
    expect(scheduler.metrics().tasksCompleted).toBe(5);
    expect(snapshotStore(store)).toEqual(
      snapshotStore(new EntryStore(entries))
    );
  });

  test('abort mid-ingest leaves whole chunks atomic and the store consistent', async () => {
    const entries = generateEntries(1000);
    const controller = new AbortController();
    // Abort from inside the source once 250 entries have been pulled: the
    // chunk in flight (201..300) is still assembled, but the signal check
    // before applying it stops the ingest.
    async function* source(): AsyncGenerator<LedgerEntry, void, void> {
      for (let index = 0; index < entries.length; index += 1) {
        if (index === 250) {
          controller.abort();
        }
        // Microtask hop keeps this an honestly asynchronous source.
        await Promise.resolve();
        yield entries[index];
      }
    }
    const store = new EntryStore();
    const result = await store.addEntriesAsync(source(), {
      chunkSize: 100,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
    // Whole chunks only: the applied count is a multiple of the chunk size.
    expect(result.added % 100).toBe(0);
    expect(result.added).toBeGreaterThan(0);
    expect(store.getEntryCount()).toBe(result.added);
    // The applied prefix reads exactly like a sync store over those chunks.
    const reference = new EntryStore();
    reference.addEntries(entries.slice(0, result.added));
    expect(snapshotStore(store)).toEqual(snapshotStore(reference));
  });

  test('an already-aborted signal applies nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const store = new EntryStore();
    const result = await store.addEntriesAsync(generateEntries(50), {
      signal: controller.signal,
    });
    expect(result).toEqual({ added: 0, skipped: 0, aborted: true });
    expect(store.getEntryCount()).toBe(0);
  });

  test('fires the same honest mutation events as chunked sync adds', async () => {
    const entries = generateEntries(300);
    const store = new EntryStore();
    const eventIds: string[][] = [];
    store.onMutation((event) => eventIds.push([...event.entriesChanged]));
    await store.addEntriesAsync(entries, { chunkSize: 100 });
    expect(eventIds).toHaveLength(3);
    expect(eventIds.flat().sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );
  });
});
