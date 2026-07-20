import { describe, expect, test } from 'bun:test';

import { AccountStore } from '../src/AccountStore';
import { createCooperativeScheduler } from '../src/scheduler';
import type { LedgerEntry, MutationEvent, Posting } from '../src/types';

function makeEntry(
  id: string,
  date: string,
  postings: Array<[account: string, amount: number, currency?: string]>
): LedgerEntry {
  return {
    id,
    date,
    flag: 'cleared',
    payee: null,
    narration: '',
    tags: [],
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
  makeEntry('e1', '2025-01-01', [
    ['Assets:Cash', 150],
    ['Income:Sales', -150],
  ]),
  makeEntry('e2', '2025-01-02', [
    ['Assets:Bank:Maybank', 100_000],
    ['Liabilities:Loan', -100_000],
  ]),
  makeEntry('e3', '2025-01-03', [
    ['Expenses:Food:Groceries', 500],
    ['Assets:Cash', -500],
  ]),
];

function buildStore(): AccountStore {
  return new AccountStore({ entries: ENTRIES });
}

// All visible paths in render order — the observable end state most tests
// assert against, forcing the lazy derived rebuild through public reads.
function visiblePaths(store: AccountStore): string[] {
  return store
    .getVisibleSlice(0, store.getVisibleCount())
    .map((row) => row.path);
}

describe('AccountStore.addAccounts', () => {
  test('auto-creates missing ancestors, matching construction semantics', () => {
    const store = buildStore();
    const result = store.addAccounts(['Equity:Opening:Balances']);
    expect(result.ok).toBe(true);
    expect(result.added).toEqual([
      'Equity',
      'Equity:Opening',
      'Equity:Opening:Balances',
    ]);
    expect(store.hasAccount('Equity')).toBe(true);
    expect(store.hasAccount('Equity:Opening')).toBe(true);
    // The incremental end state matches building a fresh store from the
    // union of inputs.
    const rebuilt = new AccountStore({
      entries: ENTRIES,
      accountPaths: ['Equity:Opening:Balances'],
    });
    expect(visiblePaths(store)).toEqual(visiblePaths(rebuilt));
  });

  test('skips invalid paths silently and treats duplicates as no-ops', () => {
    const store = buildStore();
    const countBefore = store.getAccountCount();
    const result = store.addAccounts([
      '',
      ':Nope',
      'Assets::Broken',
      'Assets:Cash', // already present
    ]);
    expect(result.ok).toBe(true);
    expect(result.added).toEqual([]);
    expect(store.getAccountCount()).toBe(countBefore);
    expect(store.hasAccount('Assets::Broken')).toBe(false);
  });

  test('new accounts appear in the projection sorted among siblings', () => {
    const store = buildStore();
    store.addAccounts(['Assets:Bank:CIMB', 'Assets:Bank:Ambank']);
    const paths = visiblePaths(store);
    const bankChildren = paths.filter((path) =>
      path.startsWith('Assets:Bank:')
    );
    expect(bankChildren).toEqual([
      'Assets:Bank:Ambank',
      'Assets:Bank:CIMB',
      'Assets:Bank:Maybank',
    ]);
  });

  test('a leaf promoted to a group by a new child defaults to expanded', () => {
    const store = buildStore();
    store.addAccounts(['Assets:Cash:Petty']);
    expect(store.isExpanded('Assets:Cash')).toBe(true);
    expect(visiblePaths(store)).toContain('Assets:Cash:Petty');
  });
});

describe('AccountStore.removeAccounts', () => {
  test('removes the account and its whole subtree', () => {
    const store = buildStore();
    const result = store.removeAccounts(['Assets:Bank']);
    expect(result.ok).toBe(true);
    expect([...result.removed].sort()).toEqual([
      'Assets:Bank',
      'Assets:Bank:Maybank',
    ]);
    expect(store.hasAccount('Assets:Bank')).toBe(false);
    expect(store.hasAccount('Assets:Bank:Maybank')).toBe(false);
    expect(store.hasAccount('Assets')).toBe(true);
    expect(visiblePaths(store)).not.toContain('Assets:Bank:Maybank');
  });

  test('unknown paths are ignored', () => {
    const store = buildStore();
    const countBefore = store.getAccountCount();
    const result = store.removeAccounts(['Does:Not:Exist', '']);
    expect(result.ok).toBe(true);
    expect(result.removed).toEqual([]);
    expect(store.getAccountCount()).toBe(countBefore);
  });

  test('removed balances drop out of ancestor roll-ups', () => {
    const store = buildStore();
    expect(store.getRolledBalances('Assets')?.get('MYR')).toBe(99_650);
    store.removeAccounts(['Assets:Bank']);
    // Only Assets:Cash (-350) remains under Assets.
    expect(store.getRolledBalances('Assets')?.get('MYR')).toBe(-350);
    expect(store.getPostingCount('Assets:Bank:Maybank')).toBe(0);
  });
});

describe('AccountStore.moveAccount', () => {
  test('remaps every descendant path and carries balances with the subtree', () => {
    const store = buildStore();
    const result = store.moveAccount('Assets:Bank', 'Assets:Banks-New');
    expect(result.ok).toBe(true);
    expect(result.moved).toEqual([
      { from: 'Assets:Bank', to: 'Assets:Banks-New' },
      { from: 'Assets:Bank:Maybank', to: 'Assets:Banks-New:Maybank' },
    ]);
    expect(store.hasAccount('Assets:Bank')).toBe(false);
    expect(store.hasAccount('Assets:Banks-New:Maybank')).toBe(true);
    // Balances and posting counts follow the moved path.
    expect(store.getOwnBalances('Assets:Banks-New:Maybank')?.get('MYR')).toBe(
      100_000
    );
    expect(store.getPostingCount('Assets:Banks-New:Maybank')).toBe(1);
    expect(store.getRolledBalances('Assets:Banks-New')?.get('MYR')).toBe(
      100_000
    );
    // Whole-tree roll-up is unchanged: the subtree moved within Assets.
    expect(store.getRolledBalances('Assets')?.get('MYR')).toBe(99_650);
  });

  test('re-parenting across top-level groups re-rolls both ancestors', () => {
    const store = buildStore();
    store.moveAccount('Assets:Bank:Maybank', 'Equity:Maybank');
    expect(store.getRolledBalances('Assets')?.get('MYR')).toBe(-350);
    expect(store.getRolledBalances('Equity')?.get('MYR')).toBe(100_000);
    // The auto-created target ancestor is reported as added.
    const secondMove = store.moveAccount('Assets:Cash', 'Holding:Sub:Cash');
    expect(secondMove.ok).toBe(true);
    expect(secondMove.added).toEqual(['Holding', 'Holding:Sub']);
    expect(store.getRolledBalances('Holding')?.get('MYR')).toBe(-350);
  });

  test('rejects unknown source without throwing', () => {
    const store = buildStore();
    const result = store.moveAccount('Nope:Missing', 'Assets:X');
    expect(result).toEqual({
      ok: false,
      reason: 'unknown-source',
      added: [],
      removed: [],
      moved: [],
    });
  });

  test('rejects invalid target path', () => {
    const store = buildStore();
    const result = store.moveAccount('Assets:Cash', 'Assets::Broken');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-target');
    expect(store.hasAccount('Assets:Cash')).toBe(true);
  });

  test('rejects a target inside the source subtree (self included)', () => {
    const store = buildStore();
    expect(store.moveAccount('Assets:Bank', 'Assets:Bank:Nested').reason).toBe(
      'target-inside-source'
    );
    expect(store.moveAccount('Assets:Bank', 'Assets:Bank').reason).toBe(
      'target-inside-source'
    );
    // Sibling with the source as a name prefix is NOT inside the subtree.
    expect(store.moveAccount('Assets:Bank', 'Assets:Banking').ok).toBe(true);
  });

  test('rejects an already-existing target', () => {
    const store = buildStore();
    const result = store.moveAccount('Assets:Cash', 'Income:Sales');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('target-exists');
    expect(store.hasAccount('Assets:Cash')).toBe(true);
  });

  test('carries expansion state across the rebuild keyed by path', () => {
    const store = buildStore();
    store.setExpanded('Assets:Bank', false);
    expect(store.isExpanded('Assets:Bank')).toBe(false);
    store.moveAccount('Assets:Bank', 'Assets:Vault');
    // Collapsed state followed the moved group.
    expect(store.isExpanded('Assets:Vault')).toBe(false);
    const paths = visiblePaths(store);
    expect(paths).toContain('Assets:Vault');
    expect(paths).not.toContain('Assets:Vault:Maybank');
  });

  test('does NOT rewrite journal entries referencing moved paths', () => {
    // Documented contract: entry remapping stays the caller's job (this is
    // how @cynco/accounts implements rename/drag-move). The store carries
    // its own accumulated balances with the moved path, but the caller's
    // entry objects keep their original posting accounts.
    const store = new AccountStore({ entries: ENTRIES });
    store.moveAccount('Assets:Cash', 'Assets:CashDrawer');
    expect(ENTRIES[0].postings[0].account).toBe('Assets:Cash');
    expect(store.hasAccount('Assets:Cash')).toBe(false);
    expect(store.getOwnBalances('Assets:CashDrawer')?.get('MYR')).toBe(-350);
  });
});

describe('AccountStore.batchAccounts', () => {
  test('applies ops in order with one observable end state', () => {
    const store = buildStore();
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));
    const result = store.batchAccounts([
      { type: 'add', paths: ['Equity:Opening'] },
      { type: 'move', from: 'Equity:Opening', to: 'Equity:Brought-Forward' },
      { type: 'remove', paths: ['Expenses'] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.added).toEqual(['Equity', 'Equity:Opening']);
    expect(result.moved).toEqual([
      { from: 'Equity:Opening', to: 'Equity:Brought-Forward' },
    ]);
    expect([...result.removed].sort()).toEqual([
      'Expenses',
      'Expenses:Food',
      'Expenses:Food:Groceries',
    ]);
    // Exactly ONE combined event for the whole batch.
    expect(events).toHaveLength(1);
    expect(events[0].topology?.movedPaths).toEqual([
      { from: 'Equity:Opening', to: 'Equity:Brought-Forward' },
    ]);
    expect(visiblePaths(store)).toEqual([
      'Assets',
      'Assets:Bank',
      'Assets:Bank:Maybank',
      'Assets:Cash',
      'Equity',
      'Equity:Brought-Forward',
      'Income',
      'Income:Sales',
      'Liabilities',
      'Liabilities:Loan',
    ]);
  });

  test('a rejected move stops the batch, keeping earlier ops applied', () => {
    const store = buildStore();
    const result = store.batchAccounts([
      { type: 'add', paths: ['Equity'] },
      { type: 'move', from: 'Nope', to: 'Equity:X' },
      { type: 'add', paths: ['Never:Applied'] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown-source');
    expect(result.added).toEqual(['Equity']);
    expect(store.hasAccount('Equity')).toBe(true);
    expect(store.hasAccount('Never')).toBe(false);
  });

  test('an all-no-op batch emits nothing', () => {
    const store = buildStore();
    const events: MutationEvent[] = [];
    store.onMutation((event) => events.push(event));
    const result = store.batchAccounts([
      { type: 'add', paths: ['Assets:Cash'] },
      { type: 'remove', paths: ['Does:Not:Exist'] },
    ]);
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(0);
  });
});

describe('AccountStore mutation events', () => {
  test('events list exactly the changed paths, and no-ops emit nothing', () => {
    const store = buildStore();
    const events: MutationEvent[] = [];
    const unsubscribe = store.onMutation((event) => events.push(event));

    store.addAccounts(['Assets:Cash']); // duplicate: no event
    store.removeAccounts(['Nope']); // unknown: no event
    store.moveAccount('Nope', 'Elsewhere'); // rejected: no event
    expect(events).toHaveLength(0);

    store.addAccounts(['Equity:Opening']);
    expect(events).toHaveLength(1);
    expect(events[0].entriesChanged).toEqual([]);
    expect(events[0].topology).toEqual({
      addedPaths: ['Equity', 'Equity:Opening'],
      removedPaths: [],
      movedPaths: [],
    });
    expect([...events[0].accountsChanged].sort()).toEqual([
      'Equity',
      'Equity:Opening',
    ]);

    store.moveAccount('Equity:Opening', 'Equity:BF');
    expect(events).toHaveLength(2);
    expect(events[1].topology?.movedPaths).toEqual([
      { from: 'Equity:Opening', to: 'Equity:BF' },
    ]);
    expect([...events[1].accountsChanged].sort()).toEqual([
      'Equity:BF',
      'Equity:Opening',
    ]);

    store.removeAccounts(['Equity']);
    expect(events).toHaveLength(3);
    expect([...(events[2].topology?.removedPaths ?? [])].sort()).toEqual([
      'Equity',
      'Equity:BF',
    ]);

    unsubscribe();
    store.addAccounts(['Silent:After:Unsubscribe']);
    expect(events).toHaveLength(3);
  });
});

describe('AccountStore balances and projection after mutation bursts', () => {
  test('a burst of mutations yields the same reads as an equivalent fresh store', () => {
    const store = buildStore();
    store.addAccounts(['Equity:Opening', 'Assets:Bank:CIMB']);
    store.moveAccount('Expenses:Food', 'Expenses:Makan');
    store.removeAccounts(['Liabilities:Loan']);

    // Fresh store over the caller-remapped equivalent inputs. The moved
    // account keeps its constructor-accumulated balance in the mutated
    // store, so the reference store remaps the entry postings the way
    // @cynco/accounts would.
    const remappedEntries: LedgerEntry[] = ENTRIES.filter(
      (entry) => entry.id !== 'e2'
    ).map(
      (entry): LedgerEntry => ({
        ...entry,
        postings: entry.postings.map((posting) => ({
          ...posting,
          account: posting.account.replace(/^Expenses:Food/, 'Expenses:Makan'),
        })),
      })
    );
    // e2 touched Liabilities:Loan (removed) and Assets:Bank:Maybank; keep
    // Maybank's balance by re-adding its posting standalone.
    remappedEntries.push(
      makeEntry('e2b', '2025-01-02', [['Assets:Bank:Maybank', 100_000]])
    );
    const reference = new AccountStore({
      entries: remappedEntries,
      accountPaths: ['Equity:Opening', 'Assets:Bank:CIMB', 'Liabilities'],
    });

    expect(visiblePaths(store)).toEqual(visiblePaths(reference));
    for (const path of visiblePaths(store)) {
      expect(store.getRolledBalances(path)).toEqual(
        reference.getRolledBalances(path) ?? new Map()
      );
      expect(store.getOwnBalances(path)).toEqual(
        reference.getOwnBalances(path) ?? new Map()
      );
    }
  });

  test('rolled balances match a brute force over carried own balances', () => {
    const store = buildStore();
    store.moveAccount('Assets:Bank', 'Reserves');
    store.addAccounts(['Reserves:Gold']);
    const rows = store.getVisibleSlice(0, store.getVisibleCount());
    for (const row of rows) {
      const bruteForce = new Map<string, number>();
      for (const inner of rows) {
        if (inner.path === row.path || inner.path.startsWith(`${row.path}:`)) {
          for (const [currency, amount] of inner.ownBalances) {
            bruteForce.set(currency, (bruteForce.get(currency) ?? 0) + amount);
          }
        }
      }
      for (const [currency, amount] of bruteForce) {
        if (amount !== 0) {
          expect(row.rolledBalances.get(currency)).toBe(amount);
        }
      }
    }
  });
});

describe('AccountStore.fromPathsAsync', () => {
  const PATHS = Array.from(
    { length: 500 },
    (_, index) =>
      `Top${String(index % 7).padStart(2, '0')}:Mid${String(index % 13).padStart(2, '0')}:Leaf${String(index).padStart(3, '0')}`
  );

  test('is read-for-read identical to synchronous construction', async () => {
    const asyncStore = await AccountStore.fromPathsAsync(PATHS, {
      chunkSize: 64,
    });
    const syncStore = new AccountStore({ accountPaths: PATHS });
    expect(asyncStore.getAccountCount()).toBe(syncStore.getAccountCount());
    expect(visiblePaths(asyncStore)).toEqual(visiblePaths(syncStore));
  });

  test('works through a cooperative scheduler and an async source', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    async function* pathSource(): AsyncGenerator<string, void, void> {
      for (const path of PATHS) {
        // Microtask hop keeps this an honestly asynchronous source.
        await Promise.resolve();
        yield path;
      }
    }
    const store = await AccountStore.fromPathsAsync(pathSource(), {
      scheduler,
      chunkSize: 50,
    });
    expect(store.getAccountCount()).toBe(
      new AccountStore({ accountPaths: PATHS }).getAccountCount()
    );
    // 500 paths / 50 per chunk = 10 scheduled chunk tasks.
    expect(scheduler.metrics().tasksCompleted).toBe(10);
  });
});
