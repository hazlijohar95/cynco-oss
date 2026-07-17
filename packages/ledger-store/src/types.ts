// Canonical domain types shared by every package in the ledger suite. The
// shapes here are the contract between the data engine (this package), the
// register renderer (@cynco/journals), and the chart-of-accounts tree
// (@cynco/accounts) — change them only via the shared spec.

/**
 * Integer minor units (sen, cents). Never floats: all monetary arithmetic in
 * the suite happens on integers so no rounding error can ever appear in a
 * balance. Values must stay within `Number.MAX_SAFE_INTEGER`;
 * `assertSafeMinorUnits` guards that invariant at hot boundaries.
 */
export type MinorUnits = number;

/**
 * Lifecycle flag on a ledger entry.
 *
 * - `cleared`: reconciled against an external source (bank statement).
 * - `pending`: recorded but not yet reconciled.
 * - `flagged`: needs human attention (suspense, unbalanced source, query).
 * - `void`: kept for audit trail but excluded from meaning by renderers.
 */
export type EntryFlag = 'cleared' | 'pending' | 'flagged' | 'void';

/**
 * A single leg of a double-entry transaction. Every entry carries two or more
 * postings, and the amounts per currency across an entry's postings must sum
 * to exactly zero for the entry to be balanced.
 */
export interface Posting {
  /** Canonical colon-delimited account path, e.g. `Assets:Current:Cash-Maybank`. */
  account: string;
  /** Signed integer minor units. Positive = debit, negative = credit. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. `MYR`, `USD`. */
  currency: string;
}

/**
 * One journal entry (transaction). Entries are immutable value objects from
 * the store's perspective: mutation APIs replace whole entries by `id` rather
 * than patching fields in place.
 */
export interface LedgerEntry {
  /** Stable unique id (caller-provided). Uniqueness is per store. */
  id: string;
  /** ISO date `YYYY-MM-DD`. Entries sort by `(date, id)`. */
  date: string;
  /** Lifecycle flag; see {@link EntryFlag}. */
  flag: EntryFlag;
  /** Counterparty display name (`TNB`, `Maybank`), or null when unknown. */
  payee: string | null;
  /** Free-text description of the transaction. May be empty. */
  narration: string;
  /** Lowercase tags for filtering, without any `#` prefix. */
  tags: readonly string[];
  /** Cross-reference link ids (invoice numbers, document ids). */
  links: readonly string[];
  /** The double-entry legs. Balanced entries zero-sum per currency. */
  postings: readonly Posting[];
}

/**
 * One visible row of the chart-of-accounts tree, as returned by
 * `AccountStore.getVisibleSlice`. Rows are materialized per slice call
 * (slices are viewport-sized, so the per-row allocation cost stays bounded);
 * hot per-node data lives in typed arrays inside the store.
 */
export interface AccountRow {
  /** Canonical colon-delimited account path. */
  path: string;
  /** Leaf segment of the path (`Cash-Maybank` for `Assets:Current:Cash-Maybank`). */
  name: string;
  /** Zero-based tree depth; top-level accounts (`Assets`) are depth 0. */
  depth: number;
  /** `group` when the account has child accounts, `leaf` otherwise. */
  kind: 'group' | 'leaf';
  /** Whether a group row is currently expanded. Always false for leaves. */
  expanded: boolean;
  /**
   * Balance of postings directly on this account, per currency code.
   * Currencies with a zero balance are omitted; absence means zero.
   */
  ownBalances: ReadonlyMap<string, MinorUnits>;
  /**
   * Rolled-up balance (own + all descendants), per currency code.
   * Currencies with a zero balance are omitted; absence means zero.
   */
  rolledBalances: ReadonlyMap<string, MinorUnits>;
  /** Number of postings directly on this account (descendants excluded). */
  postingCount: number;
  /** Total number of siblings sharing this row's parent (aria-setsize). */
  setSize: number;
  /** One-based position among those siblings (aria-posinset). */
  posInSet: number;
}

/**
 * One virtualization-ready row of an account register, as returned by
 * `EntryStore.getRegisterRows`. A register lists every posting touching one
 * account (optionally including descendant accounts) in `(date, id)` order.
 */
export interface RegisterRow {
  /** The entry this posting belongs to (shared reference, not a copy). */
  entry: LedgerEntry;
  /** The posting that touches the queried account. */
  posting: Posting;
  /**
   * Running balance in the posting's own currency after applying this
   * posting: the sum of all register postings in `posting.currency` up to and
   * including this row. Currencies run independently, mirroring how a
   * multi-currency account statement is read.
   */
  runningBalance: MinorUnits;
}

/**
 * Entry-level filter applied by `EntryStore.filterEntries` and (optionally)
 * by register queries. All present conditions must match (logical AND).
 */
export interface EntryFilter {
  /** Inclusive ISO date lower bound (`YYYY-MM-DD`). */
  dateFrom?: string;
  /** Inclusive ISO date upper bound (`YYYY-MM-DD`). */
  dateTo?: string;
  /** Match entries with exactly this flag. */
  flag?: EntryFlag;
  /** Match entries carrying this tag (exact tag match). */
  tag?: string;
  /**
   * Case-insensitive substring match over payee and narration. The store
   * precomputes lowercase search text so repeated queries never re-lowercase
   * the corpus.
   */
  query?: string;
}

/** Options bag for `EntryStore.getRegisterRows` / `getRegisterRowCount`. */
export interface RegisterOptions {
  /** Slice start index (inclusive). Clamped to the valid range. */
  start: number;
  /** Slice end index (exclusive). Clamped to the valid range. */
  end: number;
  /**
   * When true, postings on descendant accounts (`Assets:Current:*` for
   * `Assets:Current`) are included in the register. Defaults to false.
   */
  includeDescendants?: boolean;
  /**
   * Optional entry-level filter. Filtered register queries compute running
   * balances over the filtered posting sequence and bypass the prefix-sum
   * cache; unfiltered queries hit the cache.
   */
  filter?: EntryFilter;
}

/**
 * Semantic invalidation data fired after every `EntryStore` mutation. The
 * event is honest: it lists only entries that actually changed (a duplicate
 * add or a no-op remove contributes nothing) and the account paths whose
 * registers/balances those changes touched.
 */
export interface MutationEvent {
  /** Ids of entries added, removed, or replaced by the mutation. */
  entriesChanged: readonly string[];
  /** Deduplicated account paths referenced by the changed entries' postings. */
  accountsChanged: readonly string[];
}

/** Options bag for constructing an `AccountStore`. */
export interface AccountStoreOptions {
  /** Entries whose posting accounts seed the tree and its balances. */
  entries?: readonly LedgerEntry[];
  /**
   * Explicit account paths to include even when no posting references them
   * (a full chart of accounts with zero-activity accounts). Invalid paths
   * are skipped silently — parsers degrade gracefully.
   */
  accountPaths?: readonly string[];
}
