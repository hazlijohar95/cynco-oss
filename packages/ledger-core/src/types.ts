// Canonical domain types shared by every package in the ledger suite. The
// shapes here are the contract between the data engine (this package), the
// register renderer (@cynco/journals), and the chart-of-accounts tree
// (@cynco/accounts) — change them only via the shared spec.

import type { CooperativeScheduler } from './scheduler';

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
 * The account-topology variant payload of a {@link MutationEvent}: exactly
 * which account paths an `AccountStore` mutation created, deleted, or
 * remapped. Moved subtrees list every affected path as a from→to pair (the
 * subtree root and each descendant), so subscribers can remap their own
 * path-keyed state without re-deriving the subtree themselves.
 */
export interface AccountTopologyChange {
  /** Canonical paths created by the mutation (implied ancestors included). */
  addedPaths: readonly string[];
  /** Canonical paths deleted by the mutation (descendants included). */
  removedPaths: readonly string[];
  /** Every remapped path as a from→to pair, subtree root first. */
  movedPaths: ReadonlyArray<{ from: string; to: string }>;
}

/**
 * Semantic invalidation data fired after every store mutation. The event is
 * honest: it lists only entries/accounts that actually changed (a duplicate
 * add or a no-op remove contributes nothing).
 *
 * Two variants share this shape: entry mutations (`EntryStore`) leave
 * `topology` undefined and list the changed entry ids plus the account paths
 * their postings touch; account-topology mutations (`AccountStore`) carry a
 * {@link AccountTopologyChange} in `topology`, list no entry ids, and use
 * `accountsChanged` for the deduplicated union of every added, removed, and
 * moved (both from and to) path.
 */
export interface MutationEvent {
  /** Ids of entries added, removed, or replaced by the mutation. */
  entriesChanged: readonly string[];
  /** Deduplicated account paths referenced by the changed entries' postings. */
  accountsChanged: readonly string[];
  /** Present only on account-topology mutations; see {@link AccountTopologyChange}. */
  topology?: AccountTopologyChange;
  /**
   * Present only on child-load transitions that must reach views:
   * `completeChildLoad` (alongside its `topology`) and `failChildLoad`
   * (alone). See {@link AccountChildLoadChange}.
   */
  childLoad?: AccountChildLoadChange;
}

/**
 * Machine-readable reasons an `AccountStore.moveAccount` (or a move op inside
 * `batchAccounts`) is rejected. Rejections return a result with `ok: false`
 * instead of throwing — topology mutations degrade gracefully like every
 * other parser boundary in this package. `not-loading` is the child-load
 * variant: `completeChildLoad` was called for a path that has no load in
 * flight (unknown path, or the state machine sits in a different state).
 */
export type AccountMutationRejectionReason =
  | 'unknown-source'
  | 'invalid-target'
  | 'target-inside-source'
  | 'target-exists'
  | 'not-loading';

/**
 * Where a path sits in the child-loading state machine:
 *
 * - `loaded` (default): the path's children — possibly none — are all known
 *   to the store. Every path is `loaded` unless `markUnloaded` said otherwise.
 * - `unloaded`: the path claims children that have not been fetched yet. The
 *   path renders as an expandable GROUP even with zero children in the store.
 * - `loading`: a fetch is in flight (`beginChildLoad`).
 * - `error`: the last fetch failed (`failChildLoad`); `error` carries the
 *   remembered message until a retry transitions back to `loading`.
 */
export type AccountChildLoadStateKind =
  | 'loaded'
  | 'unloaded'
  | 'loading'
  | 'error';

/**
 * Result of `AccountStore.getChildLoadState`. Unknown paths and paths that
 * never entered the machine report `{ state: 'loaded' }` — graceful
 * degradation, absence means "nothing pending".
 */
export interface AccountChildLoadState {
  state: AccountChildLoadStateKind;
  /** Remembered failure message; present only in the `error` state. */
  error?: string;
}

/**
 * The child-load variant payload of a {@link MutationEvent}: which path's
 * load machine transitioned and to which state. `completeChildLoad` emits ONE
 * event carrying both the topology change (the added children) and this
 * transition (`state: 'loaded'`); `failChildLoad` emits an event carrying
 * only this transition (`state: 'error'` plus the message) — no topology
 * changed, but views must re-render the group row (drop the spinner, show
 * the error affordance).
 */
export interface AccountChildLoadChange {
  /** Canonical path whose load state transitioned. */
  path: string;
  /** The state the machine landed in. */
  state: AccountChildLoadStateKind;
  /** Failure message; present only when `state` is `error`. */
  error?: string;
}

/**
 * Outcome of one `AccountStore` topology mutation call. `added`, `removed`,
 * and `moved` list exactly the paths the call changed (mirroring the emitted
 * {@link AccountTopologyChange}); a rejected move sets `ok: false` plus a
 * {@link AccountMutationRejectionReason} and changes nothing further.
 */
export interface AccountMutationResult {
  /** False only when a move op was rejected; adds/removes always succeed. */
  ok: boolean;
  /** Why the mutation was rejected; present only when `ok` is false. */
  reason?: AccountMutationRejectionReason;
  /** Canonical paths created (implied ancestors included). */
  added: string[];
  /** Canonical paths deleted (descendants included). */
  removed: string[];
  /** Every remapped path as a from→to pair, subtree root first. */
  moved: Array<{ from: string; to: string }>;
}

/**
 * One operation inside `AccountStore.batchAccounts`. Ops apply in order
 * against the live path collection, so later ops see the effects of earlier
 * ones (a batch may add a subtree and immediately move it).
 */
export type AccountMutationOp =
  | { type: 'add'; paths: readonly string[] }
  | { type: 'remove'; paths: readonly string[] }
  | { type: 'move'; from: string; to: string };

/**
 * Options bag for `EntryStore.addEntriesAsync`. The scheduler is the shared
 * cooperative scheduler from `createCooperativeScheduler`; when omitted the
 * ingest still yields to the event loop between chunks via `setTimeout(0)`.
 */
export interface EntryIngestOptions {
  /** Shared cooperative scheduler; chunk application runs as its tasks. */
  scheduler?: CooperativeScheduler;
  /** Entries applied per chunk before yielding. Defaults to 5000. */
  chunkSize?: number;
  /**
   * Aborting stops the ingest before the next chunk. Chunks are atomic:
   * every chunk already applied stays applied and the store remains
   * consistent; the returned result reports `aborted: true`.
   */
  signal?: AbortSignal;
}

/**
 * Outcome of `EntryStore.addEntriesAsync`: how many entries were inserted,
 * how many were skipped as duplicate ids (same dedupe rules as the
 * synchronous `addEntries`), and whether the ingest stopped early because
 * the caller's `AbortSignal` fired.
 */
export interface EntryIngestResult {
  /** Entries actually inserted into the store. */
  added: number;
  /** Entries skipped because their id already existed. */
  skipped: number;
  /** True when the ingest stopped early via the caller's AbortSignal. */
  aborted: boolean;
}

/**
 * Options bag for `AccountStore.fromPathsAsync`. Mirrors
 * {@link EntryIngestOptions} minus the abort signal — a partially built
 * chart of accounts is not a useful artifact, so construction either
 * completes or the caller drops the promise.
 */
export interface AccountStoreAsyncOptions {
  /** Shared cooperative scheduler; chunk collection runs as its tasks. */
  scheduler?: CooperativeScheduler;
  /** Paths collected per chunk before yielding. Defaults to 5000. */
  chunkSize?: number;
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
