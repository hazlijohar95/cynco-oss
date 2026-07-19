// mitata benchmarks for the ledger-store hot paths: AccountStore build and
// visible-projection reads over 50k accounts, and EntryStore register
// running-balance builds over 100k entries.
//
// Fixture generation is inlined (a local mulberry32) instead of importing
// @cynco/ledger-test-data: that package depends on this one for its types,
// and a devDependency back onto it would create a workspace cycle.

import { bench, do_not_optimize, group, run } from 'mitata';

import { AccountStore } from '../src/AccountStore';
import { EntryStore } from '../src/EntryStore';
import type { LedgerEntry } from '../src/types';

const ACCOUNT_TOP_COUNT = 50;
const ACCOUNT_MID_COUNT = 20;
const ACCOUNT_LEAF_COUNT = 50; // 50 * 20 * 50 = 50_000 leaf accounts
const ENTRY_COUNT = 100_000;
const VIEWPORT_SIZE = 100;
const SEED = 0x1ed6e2;

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateAccountPaths(): string[] {
  const paths: string[] = [];
  for (let top = 0; top < ACCOUNT_TOP_COUNT; top += 1) {
    for (let mid = 0; mid < ACCOUNT_MID_COUNT; mid += 1) {
      for (let leaf = 0; leaf < ACCOUNT_LEAF_COUNT; leaf += 1) {
        paths.push(
          `Top${String(top).padStart(2, '0')}:Mid${String(mid).padStart(2, '0')}:Leaf${String(leaf).padStart(2, '0')}`
        );
      }
    }
  }
  return paths;
}

// Balanced two-posting entries between random leaf accounts, dated across
// one year. Deterministic so benchmark runs are comparable.
function generateEntries(accountPaths: readonly string[]): LedgerEntry[] {
  const random = createMulberry32(SEED);
  const entries: LedgerEntry[] = [];
  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    const debitAccount =
      accountPaths[Math.floor(random() * accountPaths.length)];
    const creditAccount =
      accountPaths[Math.floor(random() * accountPaths.length)];
    const amount = (1 + Math.floor(random() * 10_000)) * 100;
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 28);
    entries.push({
      id: `e${String(index + 1).padStart(7, '0')}`,
      date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      flag: 'cleared',
      payee: 'Benchmark Counterparty',
      narration: 'benchmark entry',
      tags: [],
      links: [],
      postings: [
        { account: debitAccount, amount, currency: 'MYR' },
        { account: creditAccount, amount: -amount, currency: 'MYR' },
      ],
    });
  }
  return entries;
}

const accountPaths = generateAccountPaths();
const entries = generateEntries(accountPaths);

// Shared stores for read benchmarks (built once so read timings do not
// include construction).
const accountStore = new AccountStore({ entries, accountPaths });
accountStore.expandAll();
const visibleCount = accountStore.getVisibleCount();
const entryStore = new EntryStore(entries);

// Rotate the queried account so every register build is a cache miss; the
// warm benchmark reuses one account so every read is a cache hit.
let coldAccountCursor = 0;

group('AccountStore (50k accounts, 100k entries)', () => {
  bench('build (tree + balances + roll-up)', () => {
    do_not_optimize(new AccountStore({ entries, accountPaths }));
  });

  bench(`getVisibleSlice viewport of ${VIEWPORT_SIZE} (middle)`, () => {
    const start = (visibleCount - VIEWPORT_SIZE) >> 1;
    do_not_optimize(accountStore.getVisibleSlice(start, start + VIEWPORT_SIZE));
  });

  bench('expandAll + projection rebuild', () => {
    accountStore.collapseAll();
    accountStore.expandAll();
    do_not_optimize(accountStore.getVisibleCount());
  });

  bench('collapseAll + projection rebuild', () => {
    accountStore.expandAll();
    accountStore.collapseAll();
    do_not_optimize(accountStore.getVisibleCount());
  });
});

// Mutation-burst fixture: a dedicated store (mutations would dirty the
// shared read store) plus a generation counter so every burst renames a
// fresh set of top-level groups — steady-state tree size, no path
// collisions across iterations.
const mutationStore = new AccountStore({ entries, accountPaths });
mutationStore.getVisibleCount(); // force the initial derived build
let topNames = Array.from(
  { length: ACCOUNT_TOP_COUNT },
  (_, top) => `Top${String(top).padStart(2, '0')}`
);
let moveGeneration = 0;

group('AccountStore mutations (50k accounts)', () => {
  bench('100-move burst + one projection read (lazy single rebuild)', () => {
    moveGeneration += 1;
    const nextNames: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const slot = index % ACCOUNT_TOP_COUNT;
      const from = index < ACCOUNT_TOP_COUNT ? topNames[slot] : nextNames[slot];
      const to = `G${moveGeneration}x${index}`;
      mutationStore.moveAccount(from, to);
      nextNames[slot] = to;
    }
    topNames = nextNames;
    do_not_optimize(mutationStore.getVisibleCount());
  });

  bench('addAccounts of 1k new leaves + projection read', () => {
    moveGeneration += 1;
    const paths: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      paths.push(`${topNames[0]}:Added${moveGeneration}:Leaf${index}`);
    }
    mutationStore.addAccounts(paths);
    mutationStore.getVisibleCount();
    do_not_optimize(
      mutationStore.removeAccounts([`${topNames[0]}:Added${moveGeneration}`])
    );
  });
});

group('EntryStore (100k entries)', () => {
  bench('build (sort + id index)', () => {
    do_not_optimize(new EntryStore(entries));
  });

  bench('register running-balance build (cold account)', () => {
    const account = accountPaths[coldAccountCursor % accountPaths.length];
    coldAccountCursor += 1;
    do_not_optimize(
      entryStore.getRegisterRows(account, { start: 0, end: VIEWPORT_SIZE })
    );
  });

  bench('register slice read (warm cache)', () => {
    do_not_optimize(
      entryStore.getRegisterRows(accountPaths[0], {
        start: 0,
        end: VIEWPORT_SIZE,
      })
    );
  });

  bench('register rows with descendants (Top00 subtree, cold)', () => {
    const top = `Top${String(coldAccountCursor % ACCOUNT_TOP_COUNT).padStart(2, '0')}`;
    coldAccountCursor += 1;
    do_not_optimize(
      entryStore.getRegisterRows(top, {
        start: 0,
        end: VIEWPORT_SIZE,
        includeDescendants: true,
      })
    );
  });

  bench('addEntriesAsync 100k entries (5k chunks, setTimeout yields)', async () => {
    const store = new EntryStore();
    do_not_optimize(await store.addEntriesAsync(entries));
  });
});

await run();
