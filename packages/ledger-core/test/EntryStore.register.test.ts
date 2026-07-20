import { describe, expect, test } from 'bun:test';

import { EntryStore } from '../src/EntryStore';
import type {
  EntryFlag,
  LedgerEntry,
  MutationEvent,
  Posting,
  RegisterRow,
} from '../src/types';

function makeEntry(
  id: string,
  date: string,
  postings: Array<[account: string, amount: number, currency?: string]>,
  overrides: Partial<
    Pick<LedgerEntry, 'flag' | 'narration' | 'payee' | 'tags'>
  > = {}
): LedgerEntry {
  return {
    id,
    date,
    flag: overrides.flag ?? 'cleared',
    payee: overrides.payee ?? null,
    narration: overrides.narration ?? '',
    tags: overrides.tags ?? [],
    links: [],
    postings: postings.map(
      ([account, amount, currency]): Posting => ({
        account,
        amount,
        currency: currency ?? 'MYR',
      })
    ),
  };
}

const ENTRIES: LedgerEntry[] = [
  makeEntry(
    'e1',
    '2025-01-01',
    [
      ['Assets:Cash', 1_000],
      ['Income:Sales', -1_000],
    ],
    { payee: 'TNB', narration: 'January invoice' }
  ),
  makeEntry(
    'e2',
    '2025-01-05',
    [
      ['Assets:Cash', -300],
      ['Expenses:Food', 300],
    ],
    { flag: 'pending', payee: 'Grab', tags: ['travel'] }
  ),
  makeEntry(
    'e3',
    '2025-01-05',
    [
      ['Assets:Cash', 500, 'USD'],
      ['Income:Export', -500, 'USD'],
    ],
    { payee: 'Acme Corp' }
  ),
  makeEntry(
    'e4',
    '2025-02-01',
    [
      ['Assets:Cash', -200],
      ['Assets:Bank:Maybank', 200],
    ],
    { narration: 'transfer to Maybank' }
  ),
];

// Compact behavioral projection of register rows.
function projectRegister(rows: readonly RegisterRow[]): string[] {
  return rows.map(
    (row) =>
      `${row.entry.date} ${row.entry.id} ${row.posting.amount}${row.posting.currency} run=${row.runningBalance}`
  );
}

// Brute-force running balances: per-currency cumulative sums over the
// account's postings in (date, id) order, used to verify the prefix-sum
// index.
function bruteForceRegister(
  entries: readonly LedgerEntry[],
  account: string
): string[] {
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1
  );
  const running = new Map<string, number>();
  const rows: string[] = [];
  for (const entry of sorted) {
    for (const posting of entry.postings) {
      if (posting.account !== account) {
        continue;
      }
      const next = (running.get(posting.currency) ?? 0) + posting.amount;
      running.set(posting.currency, next);
      rows.push(
        `${entry.date} ${entry.id} ${posting.amount}${posting.currency} run=${next}`
      );
    }
  }
  return rows;
}

describe('EntryStore ordering and slices', () => {
  test('entries sort by (date, id) regardless of ingest order', () => {
    const store = new EntryStore([
      ENTRIES[3],
      ENTRIES[1],
      ENTRIES[0],
      ENTRIES[2],
    ]);
    expect(store.getEntryCount()).toBe(4);
    expect(store.getEntrySlice(0, 10).map((entry) => entry.id)).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
    ]);
    expect(store.getEntrySlice(1, 3).map((entry) => entry.id)).toEqual([
      'e2',
      'e3',
    ]);
    expect(store.getEntrySlice(-5, 1).map((entry) => entry.id)).toEqual(['e1']);
    expect(store.getEntrySlice(3, 99)).toHaveLength(1);
  });

  test('duplicate ids at construction keep the first occurrence', () => {
    const duplicate = makeEntry('e1', '2025-03-01', [['Assets:Cash', 7]]);
    const store = new EntryStore([...ENTRIES, duplicate]);
    expect(store.getEntryCount()).toBe(4);
    expect(store.getEntryById('e1')?.date).toBe('2025-01-01');
  });
});

describe('EntryStore register', () => {
  test('running balances match brute force per currency', () => {
    const store = new EntryStore(ENTRIES);
    const rows = store.getRegisterRows('Assets:Cash', { start: 0, end: 99 });
    expect(projectRegister(rows)).toEqual(
      bruteForceRegister(ENTRIES, 'Assets:Cash')
    );
    expect(projectRegister(rows)).toEqual([
      '2025-01-01 e1 1000MYR run=1000',
      '2025-01-05 e2 -300MYR run=700',
      '2025-01-05 e3 500USD run=500',
      '2025-02-01 e4 -200MYR run=500',
    ]);
  });

  test('slices of the register agree with the full read', () => {
    const store = new EntryStore(ENTRIES);
    const full = projectRegister(
      store.getRegisterRows('Assets:Cash', { start: 0, end: 99 })
    );
    expect(
      projectRegister(
        store.getRegisterRows('Assets:Cash', { start: 1, end: 3 })
      )
    ).toEqual(full.slice(1, 3));
    expect(store.getRegisterRowCount('Assets:Cash')).toBe(4);
  });

  test('includeDescendants folds child-account postings into the register', () => {
    const store = new EntryStore(ENTRIES);
    expect(store.getRegisterRowCount('Assets')).toBe(0);
    const rows = store.getRegisterRows('Assets', {
      start: 0,
      end: 99,
      includeDescendants: true,
    });
    expect(projectRegister(rows)).toEqual([
      '2025-01-01 e1 1000MYR run=1000',
      '2025-01-05 e2 -300MYR run=700',
      '2025-01-05 e3 500USD run=500',
      '2025-02-01 e4 -200MYR run=500',
      '2025-02-01 e4 200MYR run=700',
    ]);
  });

  test('date filtering recomputes running balances over the filtered set', () => {
    const store = new EntryStore(ENTRIES);
    const rows = store.getRegisterRows('Assets:Cash', {
      start: 0,
      end: 99,
      filter: { dateFrom: '2025-01-05', dateTo: '2025-02-01' },
    });
    // e1 is excluded, so the running balance restarts from the filtered set.
    expect(projectRegister(rows)).toEqual([
      '2025-01-05 e2 -300MYR run=-300',
      '2025-01-05 e3 500USD run=500',
      '2025-02-01 e4 -200MYR run=-500',
    ]);
    expect(
      store.getRegisterRowCount('Assets:Cash', {
        filter: { dateFrom: '2025-01-05', dateTo: '2025-02-01' },
      })
    ).toBe(3);
  });

  test('flag, tag, and query filters', () => {
    const store = new EntryStore(ENTRIES);
    expect(store.filterEntries({ flag: 'pending' }).map((e) => e.id)).toEqual([
      'e2',
    ]);
    expect(store.filterEntries({ tag: 'travel' }).map((e) => e.id)).toEqual([
      'e2',
    ]);
    // Case-insensitive substring over payee and narration.
    expect(store.filterEntries({ query: 'tnb' }).map((e) => e.id)).toEqual([
      'e1',
    ]);
    expect(store.filterEntries({ query: 'MAYBANK' }).map((e) => e.id)).toEqual([
      'e4',
    ]);
    expect(store.filterEntries({ query: 'nope' })).toHaveLength(0);
    const flagged: EntryFlag = 'void';
    expect(store.filterEntries({ flag: flagged })).toHaveLength(0);
  });

  test('invalid account paths yield empty registers, never throw', () => {
    const store = new EntryStore(ENTRIES);
    expect(store.getRegisterRows('Assets::Cash', { start: 0, end: 9 })).toEqual(
      []
    );
    expect(store.getRegisterRowCount('')).toBe(0);
  });

  test('normal registers report no running-balance overflow', () => {
    const store = new EntryStore(ENTRIES);
    expect(store.hasRunningBalanceOverflow('Assets:Cash')).toBe(false);
    expect(
      store.hasRunningBalanceOverflow('Assets:Cash', { currency: 'MYR' })
    ).toBe(false);
  });

  test('a running balance past 2^53 is flagged, not silently poisoned', () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    // Two safe-integer debits to the same account whose carry-forward running
    // balance crosses the exactly-representable range.
    const store = new EntryStore([
      makeEntry('big1', '2025-01-01', [
        ['Assets:Cash', half],
        ['Income:Sales', -half],
      ]),
      makeEntry('big2', '2025-01-02', [
        ['Assets:Cash', half],
        ['Income:Sales', -half],
      ]),
    ]);
    expect(store.hasRunningBalanceOverflow('Assets:Cash')).toBe(true);
    expect(
      store.hasRunningBalanceOverflow('Assets:Cash', { currency: 'MYR' })
    ).toBe(true);
    expect(
      store.hasRunningBalanceOverflow('Assets:Cash', { currency: 'USD' })
    ).toBe(false);
    // Invalid path stays graceful.
    expect(store.hasRunningBalanceOverflow('')).toBe(false);
  });
});

describe('EntryStore mutation', () => {
  test('addEntries resorts, invalidates the register cache, and fires an honest event', () => {
    const store = new EntryStore(ENTRIES);
    // Prime the register cache.
    expect(store.getRegisterRowCount('Assets:Cash')).toBe(4);

    const events: MutationEvent[] = [];
    const unsubscribe = store.onMutation((event) => events.push(event));

    // Dated between e1 and e2, so it must land in the middle of the register.
    const inserted = makeEntry('e1b', '2025-01-03', [
      ['Assets:Cash', 250],
      ['Income:Sales', -250],
    ]);
    store.addEntries([inserted, ENTRIES[0]]); // duplicate e1 must be skipped

    expect(events).toHaveLength(1);
    expect(events[0].entriesChanged).toEqual(['e1b']);
    expect([...events[0].accountsChanged].sort()).toEqual([
      'Assets:Cash',
      'Income:Sales',
    ]);

    const rows = store.getRegisterRows('Assets:Cash', { start: 0, end: 99 });
    expect(projectRegister(rows)).toEqual([
      '2025-01-01 e1 1000MYR run=1000',
      '2025-01-03 e1b 250MYR run=1250',
      '2025-01-05 e2 -300MYR run=950',
      '2025-01-05 e3 500USD run=500',
      '2025-02-01 e4 -200MYR run=750',
    ]);

    unsubscribe();
    store.addEntries([makeEntry('e9', '2025-03-01', [['Assets:Cash', 1]])]);
    expect(events).toHaveLength(1); // unsubscribed listeners stay silent
  });

  test('removeEntries drops rows and reports only real removals', () => {
    const store = new EntryStore(ENTRIES);
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));

    store.removeEntries(['e2', 'does-not-exist']);
    expect(events).toHaveLength(1);
    expect(events[0].entriesChanged).toEqual(['e2']);
    expect(store.getEntryCount()).toBe(3);
    expect(
      projectRegister(
        store.getRegisterRows('Assets:Cash', { start: 0, end: 99 })
      )
    ).toEqual([
      '2025-01-01 e1 1000MYR run=1000',
      '2025-01-05 e3 500USD run=500',
      '2025-02-01 e4 -200MYR run=800',
    ]);

    store.removeEntries(['does-not-exist']);
    expect(events).toHaveLength(1); // no-op remove fires no event
  });

  test('replaceEntries upserts and reports both old and new accounts', () => {
    const store = new EntryStore(ENTRIES);
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));

    const replacement = makeEntry('e2', '2025-01-10', [
      ['Assets:Bank:Maybank', -300],
      ['Expenses:Software', 300],
    ]);
    const fresh = makeEntry('e5', '2025-02-10', [
      ['Assets:Cash', 50],
      ['Income:Sales', -50],
    ]);
    store.replaceEntries([replacement, fresh]);

    expect(events).toHaveLength(1);
    expect([...events[0].entriesChanged].sort()).toEqual(['e2', 'e5']);
    // Old accounts (Assets:Cash, Expenses:Food) and new ones both appear.
    expect(events[0].accountsChanged).toContain('Expenses:Food');
    expect(events[0].accountsChanged).toContain('Expenses:Software');

    expect(store.getEntryCount()).toBe(5);
    expect(store.getEntryById('e2')?.date).toBe('2025-01-10');
    expect(store.getEntrySlice(0, 9).map((entry) => entry.id)).toEqual([
      'e1',
      'e3',
      'e2',
      'e4',
      'e5',
    ]);
  });
});
