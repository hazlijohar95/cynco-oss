// Chart-of-accounts tree engine. Built from entries and/or explicit account
// paths, and incrementally mutable: addAccounts / removeAccounts /
// moveAccount / batchAccounts edit the topology without rebuilding the whole
// store per call.
//
// Two-tier state, same lazy-dirty philosophy as the visible projection:
//
// 1. Canonical source of truth, cheap to mutate in O(changed paths): a
//    path set plus a children-by-parent map (topology), sparse path-keyed
//    own-balance / posting-count maps (money), and a path-keyed expansion
//    set. Mutations edit only these and drop the derived tier.
// 2. Derived Struct-of-Arrays tier, rebuilt lazily on the next read that
//    needs it: parallel Int32Arrays per hot node field, a flat CSR
//    (compressed-sparse-row) child table, DFS-preorder node ids (every
//    descendant id exceeds its ancestors', so balance roll-up is a single
//    reverse-id pass), and per-currency Float64Array balance columns.
//    Amounts are integers and Float64Array holds every integer exactly up
//    to 2^53, so the columns stay exact MinorUnits. A burst of mutations —
//    or a whole batchAccounts call — therefore pays for exactly ONE array
//    rebuild, amortized onto the first subsequent read, exactly like a
//    burst of setExpanded calls pays for one projection rebuild.
//
// Per-path state the store owns (expansion, own balances, posting counts)
// is keyed by canonical path in tier 1, so it carries across rebuilds and
// follows subtrees through moveAccount remaps automatically.
//
// The store deliberately does NOT rewrite journal entries referencing moved
// or removed paths: entries live outside this store (in an EntryStore or the
// caller's own collection), and remapping their posting accounts stays the
// caller's job — exactly how @cynco/accounts implements rename/drag-move
// today. The store carries the balances it accumulated at construction with
// the moved path (a rename keeps its history), and drops balances of removed
// subtrees.
//
// Canonical colon-delimited paths are the only account identity at the
// public boundary; numeric node ids never leak out.

import {
  getAccountLeafName,
  getAncestorAccountPaths,
  getParentAccountPath,
  isValidAccountPath,
} from './accountPath';
import { chunksOf } from './chunksOf';
import type {
  AccountChildLoadChange,
  AccountChildLoadState,
  AccountMutationOp,
  AccountMutationRejectionReason,
  AccountMutationResult,
  AccountRow,
  AccountStoreAsyncOptions,
  AccountStoreOptions,
  AccountTopologyChange,
  MinorUnits,
  MutationEvent,
} from './types';

// Node id 0 is a virtual root that parents every top-level account; it never
// appears in the visible projection and has no path.
const ROOT_ID = 0;

const ASYNC_BUILD_CHUNK_SIZE = 5000;

// The derived Struct-of-Arrays tier (see file-level comment). Held as one
// nullable object so "derived == null" IS the topology dirty flag — the same
// idiom as the nullable visibleIds projection cache.
interface DerivedTopology {
  /** Total node slots including the virtual root. */
  nodeCount: number;
  /** Parallel per-node fields, indexed by node id. */
  parentIds: Int32Array;
  depths: Int32Array;
  /**
   * CSR child table: the children of node `id` occupy
   * `childIdsFlat[firstChildIndexes[id] .. firstChildIndexes[id] + childCounts[id])`.
   */
  firstChildIndexes: Int32Array;
  childCounts: Int32Array;
  childIdsFlat: Int32Array;
  /** A node's zero-based position within its parent's (sorted) children. */
  childPositions: Int32Array;
  /** Full canonical path and leaf name per node id ('' for the root). */
  pathsById: string[];
  namesById: string[];
  idByPath: Map<string, number>;
  /** Per-currency balance columns, indexed [currencyId][nodeId]. */
  ownBalanceColumns: Float64Array[];
  rolledBalanceColumns: Float64Array[];
  /** Number of postings directly on each account. */
  postingCounts: Int32Array;
}

// Sibling order everywhere in the store: plain code-point order on leaf
// names, for determinism across runtimes and locales.
function compareSiblingPaths(a: string, b: string): number {
  const leafA = getAccountLeafName(a);
  const leafB = getAccountLeafName(b);
  return leafA < leafB ? -1 : leafA > leafB ? 1 : 0;
}

// Shared empty-shape for rejected moves; a fresh object per call so callers
// can safely mutate the arrays they receive.
function rejectedMutation(
  reason: AccountMutationRejectionReason
): AccountMutationResult {
  return { ok: false, reason, added: [], removed: [], moved: [] };
}

export class AccountStore {
  // --- Canonical source of truth (tier 1; mutated in O(changed paths)) ------

  /** Every canonical account path in the store (implied ancestors included). */
  private readonly pathSet: Set<string>;
  /** Child paths per parent path; '' keys the virtual root. */
  private readonly childPathsByParent: Map<string, Set<string>>;
  /**
   * Sparse own balances per path (currency → integer amount), accumulated
   * from constructor entries and re-keyed on moves. Only paths with postings
   * appear here.
   */
  private readonly ownBalancesByPath: Map<string, Map<string, MinorUnits>>;
  /** Sparse posting counts per path; absence means zero. */
  private readonly postingCountsByPath: Map<string, number>;
  /**
   * Currency codes in first-seen order over constructor entries; index =
   * currency id in the derived balance columns. Persistent so column order
   * (and therefore balance-map iteration order) is stable across rebuilds.
   */
  private readonly currencyCodes: string[];
  private readonly currencyIdByCode: Map<string, number>;
  /**
   * Paths currently expanded, keyed by path so the state survives derived
   * rebuilds and follows moved subtrees. May contain leaf paths (new
   * accounts default to expanded, matching construction semantics); every
   * read filters through a "has children" check, so stale leaf members are
   * inert.
   */
  private readonly expandedPaths: Set<string>;
  /**
   * Child-load machine entries keyed by path (canonical tier, like
   * expansion: survives derived rebuilds and follows moveAccount remaps).
   * Absence means `loaded` — the default for every path — so the map only
   * ever holds the pending minority (`unloaded` / `loading` / `error`).
   */
  private readonly childLoadByPath: Map<
    string,
    { state: 'unloaded' | 'loading' | 'error'; error?: string }
  >;
  private readonly listeners: Set<(event: MutationEvent) => void>;

  // --- Derived tiers (lazily rebuilt; null = dirty) --------------------------

  /** SoA/CSR arrays + balance columns, or null after any topology mutation. */
  private derived: DerivedTopology | null;
  /**
   * Visible node ids in render order, or null when expansion or topology
   * changed since the last read. Node ids are only meaningful against the
   * derived tier they were built from, so any topology rebuild drops this
   * too.
   */
  private visibleIds: Int32Array | null;

  constructor(options: AccountStoreOptions = {}) {
    const { entries = [], accountPaths = [] } = options;

    this.pathSet = new Set<string>();
    this.childPathsByParent = new Map<string, Set<string>>();
    this.ownBalancesByPath = new Map<string, Map<string, MinorUnits>>();
    this.postingCountsByPath = new Map<string, number>();
    this.currencyCodes = [];
    this.currencyIdByCode = new Map<string, number>();
    this.expandedPaths = new Set<string>();
    this.childLoadByPath = new Map();
    this.listeners = new Set<(event: MutationEvent) => void>();
    this.derived = null;
    this.visibleIds = null;

    // Collect every valid account path plus all implied ancestors. Invalid
    // paths (empty, doubled colons) are skipped silently: this ingests
    // user-authored ledger data and must not throw. Construction reuses the
    // exact same path-collection primitive the addAccounts mutation uses,
    // so incremental adds match construction semantics by definition.
    const seeded: string[] = [];
    for (const entry of entries) {
      for (const posting of entry.postings) {
        this.collectPathWithAncestors(posting.account, seeded);
      }
    }
    for (const path of accountPaths) {
      this.collectPathWithAncestors(path, seeded);
    }

    // Accumulate own balances and posting counts from entry postings into
    // the path-keyed tier. Postings with invalid accounts or unsafe amounts
    // are skipped — same graceful-degradation contract as path collection.
    for (const entry of entries) {
      for (const posting of entry.postings) {
        if (
          !this.pathSet.has(posting.account) ||
          !Number.isSafeInteger(posting.amount)
        ) {
          continue;
        }
        if (!this.currencyIdByCode.has(posting.currency)) {
          this.currencyIdByCode.set(
            posting.currency,
            this.currencyCodes.length
          );
          this.currencyCodes.push(posting.currency);
        }
        let balances = this.ownBalancesByPath.get(posting.account);
        if (balances == null) {
          balances = new Map<string, MinorUnits>();
          this.ownBalancesByPath.set(posting.account, balances);
        }
        balances.set(
          posting.currency,
          (balances.get(posting.currency) ?? 0) + posting.amount
        );
        this.postingCountsByPath.set(
          posting.account,
          (this.postingCountsByPath.get(posting.account) ?? 0) + 1
        );
      }
    }
  }

  /**
   * Builds an AccountStore from a (possibly huge, possibly async) path
   * source without a single long synchronous pass: path canonicalization
   * and collection are chunked through the cooperative scheduler (or a
   * plain setTimeout(0) yield when none is given). The remaining derived
   * array build (sorting + CSR fill) still happens as ONE synchronous pass
   * on the first read — that is the store's amortization contract — but it
   * is the cheaper half, and collection no longer blocks the event loop.
   * The result is read-for-read identical to `new AccountStore({
   * accountPaths })` on the same paths.
   */
  static async fromPathsAsync(
    paths: Iterable<string> | AsyncIterable<string>,
    options: AccountStoreAsyncOptions = {}
  ): Promise<AccountStore> {
    const store = new AccountStore();
    const chunkSize = options.chunkSize ?? ASYNC_BUILD_CHUNK_SIZE;
    const scheduler = options.scheduler;
    for await (const chunk of chunksOf(paths, chunkSize)) {
      if (scheduler != null) {
        await scheduler.schedule((): { done: boolean; value?: undefined } => {
          store.addAccounts(chunk);
          return { done: true };
        });
      } else {
        store.addAccounts(chunk);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return store;
  }

  // --- Account lookups -------------------------------------------------------

  /** Number of accounts in the store (implied ancestors included). */
  getAccountCount(): number {
    return this.pathSet.size;
  }

  /** True when the canonical path names an account known to this store. */
  hasAccount(path: string): boolean {
    return this.pathSet.has(path);
  }

  /**
   * Balance of postings directly on the account, per currency (zero
   * balances omitted). Returns null for unknown paths. Served from the
   * path-keyed tier in first-seen currency order, so this read never forces
   * a derived rebuild.
   */
  getOwnBalances(path: string): Map<string, MinorUnits> | null {
    if (!this.pathSet.has(path)) {
      return null;
    }
    const balances = new Map<string, MinorUnits>();
    const own = this.ownBalancesByPath.get(path);
    if (own != null) {
      for (const currency of this.currencyCodes) {
        const amount = own.get(currency) ?? 0;
        if (amount !== 0) {
          balances.set(currency, amount);
        }
      }
    }
    return balances;
  }

  /**
   * Rolled-up balance (own + all descendants) per currency (zero balances
   * omitted). Returns null for unknown paths.
   */
  getRolledBalances(path: string): Map<string, MinorUnits> | null {
    const derived = this.ensureTopology();
    const id = derived.idByPath.get(path);
    return id == null
      ? null
      : this.readBalances(derived.rolledBalanceColumns, id);
  }

  /** Postings directly on the account; 0 for unknown paths. */
  getPostingCount(path: string): number {
    return this.postingCountsByPath.get(path) ?? 0;
  }

  // --- Topology mutations ------------------------------------------------------

  /**
   * Subscribes to mutation events. Returns an unsubscribe function. Events
   * fire synchronously after the store state is consistent, once per
   * mutation call; no-op mutations emit nothing.
   */
  onMutation(listener: (event: MutationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Adds accounts, auto-creating missing ancestors — exactly the
   * construction semantics. Invalid paths are skipped silently and
   * already-present paths are no-ops; the result and the emitted event list
   * only the paths actually created. O(changed paths); the derived arrays
   * rebuild lazily on the next read.
   */
  addAccounts(paths: readonly string[]): AccountMutationResult {
    const added: string[] = [];
    for (const path of paths) {
      this.collectPathWithAncestors(path, added);
    }
    if (added.length > 0) {
      this.markTopologyDirty();
      this.emitTopologyChange({
        addedPaths: added,
        removedPaths: [],
        movedPaths: [],
      });
    }
    return { ok: true, added, removed: [], moved: [] };
  }

  /**
   * Removes each account AND all of its descendants; unknown paths are
   * ignored. Balances and posting counts of removed accounts are dropped
   * (their journal entries are NOT touched — see the file-level comment).
   * The result and event list every path actually removed, descendants
   * included. O(removed paths).
   */
  removeAccounts(paths: readonly string[]): AccountMutationResult {
    const removed: string[] = [];
    for (const path of paths) {
      this.removeSubtree(path, removed);
    }
    if (removed.length > 0) {
      this.markTopologyDirty();
      this.emitTopologyChange({
        addedPaths: [],
        removedPaths: removed,
        movedPaths: [],
      });
    }
    return { ok: true, added: [], removed, moved: [] };
  }

  /**
   * Re-parents/renames the subtree at `fromPath` to `toPath`, remapping
   * every descendant path and carrying expansion, balances, and posting
   * counts with each moved path. Missing ancestors of the target are
   * auto-created (reported in `added`). Rejected — result with `ok: false`
   * and a machine-readable reason, never a throw — when the source is
   * unknown, the target path is invalid, the target lies inside the source
   * subtree (including `toPath === fromPath`), or the target already
   * exists. O(subtree size).
   *
   * Journal entries referencing the moved paths are NOT rewritten; entry
   * remapping stays the caller's job.
   */
  moveAccount(fromPath: string, toPath: string): AccountMutationResult {
    const reason = this.validateMove(fromPath, toPath);
    if (reason != null) {
      return rejectedMutation(reason);
    }
    const added: string[] = [];
    const moved: Array<{ from: string; to: string }> = [];
    this.moveSubtree(fromPath, toPath, added, moved);
    this.markTopologyDirty();
    this.emitTopologyChange({
      addedPaths: added,
      removedPaths: [],
      movedPaths: moved,
    });
    return { ok: true, added, removed: [], moved };
  }

  /**
   * Applies add/remove/move ops in order against the live path collection
   * (later ops see earlier ops' effects), emitting ONE combined event and
   * paying for ONE derived rebuild at the end — the whole point of
   * batching. Ops are not transactional: a rejected move stops the batch
   * and returns `ok: false` with its reason, but everything applied before
   * it stays applied (and is reported in the result and event honestly).
   */
  batchAccounts(ops: readonly AccountMutationOp[]): AccountMutationResult {
    const added: string[] = [];
    const removed: string[] = [];
    const moved: Array<{ from: string; to: string }> = [];
    let failure: AccountMutationRejectionReason | null = null;
    for (const op of ops) {
      if (op.type === 'add') {
        for (const path of op.paths) {
          this.collectPathWithAncestors(path, added);
        }
      } else if (op.type === 'remove') {
        for (const path of op.paths) {
          this.removeSubtree(path, removed);
        }
      } else {
        failure = this.validateMove(op.from, op.to);
        if (failure != null) {
          break;
        }
        this.moveSubtree(op.from, op.to, added, moved);
      }
    }
    if (added.length > 0 || removed.length > 0 || moved.length > 0) {
      this.markTopologyDirty();
      this.emitTopologyChange({
        addedPaths: added,
        removedPaths: removed,
        movedPaths: moved,
      });
    }
    if (failure != null) {
      return { ok: false, reason: failure, added, removed, moved };
    }
    return { ok: true, added, removed, moved };
  }

  // --- Expansion state ---------------------------------------------------------

  /** True when the path names a currently expanded group. */
  isExpanded(path: string): boolean {
    return this.isGroupPath(path) && this.expandedPaths.has(path);
  }

  /**
   * Expands or collapses one group. No-op for unknown paths and for leaves
   * (graceful degradation), and the projection dirty flag is only set when
   * the state actually changes.
   */
  setExpanded(path: string, expanded: boolean): void {
    if (!this.isGroupPath(path)) {
      return;
    }
    if (expanded) {
      if (!this.expandedPaths.has(path)) {
        this.expandedPaths.add(path);
        this.visibleIds = null;
      }
    } else if (this.expandedPaths.delete(path)) {
      this.visibleIds = null;
    }
  }

  /** Expands every group in the tree. */
  expandAll(): void {
    for (const [parent, children] of this.childPathsByParent) {
      if (parent !== '' && children.size > 0) {
        this.expandedPaths.add(parent);
      }
    }
    this.visibleIds = null;
  }

  /** Collapses every group; only top-level accounts remain visible. */
  collapseAll(): void {
    this.expandedPaths.clear();
    this.visibleIds = null;
  }

  // --- Child loading (lazy subtrees) -------------------------------------------

  /**
   * Declares the paths' children as not yet fetched: the paths transition to
   * `unloaded` and render as expandable GROUPS even with zero children in
   * the store (the expand affordance is what triggers the fetch). Unknown
   * paths are ignored — graceful degradation, same contract as every other
   * mutation input. Marking is a force-reset from ANY state, which doubles
   * as the cancellation primitive: a load in flight when its path is
   * re-marked finds the machine no longer in `loading` on completion, so the
   * stale result is refused at the store boundary too.
   *
   * A marked path is also collapsed: its children are unknown, so the
   * default-expanded state new accounts get would leave no gesture to
   * trigger the load with.
   */
  markUnloaded(paths: readonly string[]): void {
    for (const path of paths) {
      if (!this.pathSet.has(path)) {
        continue;
      }
      this.childLoadByPath.set(path, { state: 'unloaded' });
      if (this.expandedPaths.delete(path)) {
        this.visibleIds = null;
      }
    }
  }

  /**
   * Transitions `unloaded`/`error` → `loading`. Returns false as a no-op for
   * unknown paths and wrong states (`loaded`, or a load already in flight).
   * Deliberately emits no event: the transition is always caller-initiated
   * (the caller is about to fetch and re-render anyway), unlike
   * complete/fail which arrive asynchronously and must reach passive views.
   */
  beginChildLoad(path: string): boolean {
    const entry = this.childLoadByPath.get(path);
    if (entry == null || entry.state === 'loading') {
      return false;
    }
    this.childLoadByPath.set(path, { state: 'loading' });
    return true;
  }

  /**
   * Resolves a load in flight: adds `childPaths` through the exact
   * `addAccounts` primitive (auto-created ancestors, invalid paths skipped
   * silently) and transitions the path → `loaded`. Rejected with reason
   * `not-loading` — a no-op, mirroring the move-rejection convention — when
   * the path has no load in flight (unknown, or wrong state; a stale
   * response arriving after `markUnloaded` reset the machine lands here).
   * Emits ONE honest event carrying both the topology change (the paths
   * actually created) and the load transition in `childLoad`, so views
   * re-render the group row (spinner off, children in) from one signal.
   */
  completeChildLoad(path: string, childPaths: string[]): AccountMutationResult {
    if (this.childLoadByPath.get(path)?.state !== 'loading') {
      return rejectedMutation('not-loading');
    }
    const added: string[] = [];
    for (const childPath of childPaths) {
      this.collectPathWithAncestors(childPath, added);
    }
    this.childLoadByPath.delete(path);
    if (added.length > 0) {
      this.markTopologyDirty();
    }
    this.emitTopologyChange(
      { addedPaths: added, removedPaths: [], movedPaths: [] },
      { path, state: 'loaded' }
    );
    return { ok: true, added, removed: [], moved: [] };
  }

  /**
   * Fails a load in flight: transitions `loading` → `error`, remembers the
   * message (surfaced by `getChildLoadState` until a retry), and emits an
   * event with only the `childLoad` transition — no topology changed, but
   * views must re-render the row (spinner → error affordance). No-op when
   * the path has no load in flight.
   */
  failChildLoad(path: string, error?: string): void {
    if (this.childLoadByPath.get(path)?.state !== 'loading') {
      return;
    }
    this.childLoadByPath.set(
      path,
      error != null ? { state: 'error', error } : { state: 'error' }
    );
    const childLoad: AccountChildLoadChange =
      error != null
        ? { path, state: 'error', error }
        : { path, state: 'error' };
    const event: MutationEvent = {
      entriesChanged: [],
      accountsChanged: [path],
      childLoad,
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Where the path sits in the child-loading machine. Unknown paths and
   * ordinary (never-marked) paths report `loaded` — absence means "nothing
   * pending", never a throw.
   */
  getChildLoadState(path: string): AccountChildLoadState {
    const entry = this.childLoadByPath.get(path);
    if (entry == null) {
      return { state: 'loaded' };
    }
    return entry.error != null
      ? { state: entry.state, error: entry.error }
      : { state: entry.state };
  }

  // --- Visible projection (slice-first reads) ---------------------------------

  /** Number of rows currently visible given the expansion state. */
  getVisibleCount(): number {
    return this.ensureProjection().length;
  }

  /**
   * Materializes visible rows for the half-open range `[start, end)`,
   * clamped to the valid range. Rows are built per call — slices are
   * viewport-sized, so allocation stays bounded while the underlying
   * projection is shared typed-array state.
   */
  getVisibleSlice(start: number, end: number): AccountRow[] {
    const visible = this.ensureProjection();
    const derived = this.ensureTopology();
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.min(visible.length, Math.floor(end));
    const rows: AccountRow[] = [];
    for (let index = clampedStart; index < clampedEnd; index += 1) {
      rows.push(this.materializeRow(derived, visible[index]));
    }
    return rows;
  }

  // --- Canonical-tier mutation primitives ----------------------------------------

  /**
   * The shared path-collection primitive behind construction, addAccounts,
   * and move-target ancestor creation: registers `path` plus every missing
   * ancestor in the canonical tier, appending actually-created paths to
   * `added`. Invalid and already-present paths are no-ops. New paths (and
   * pre-existing leaves promoted to groups by gaining their first child)
   * default to expanded, matching construction's fully-expanded default.
   */
  private collectPathWithAncestors(path: string, added: string[]): void {
    if (!isValidAccountPath(path) || this.pathSet.has(path)) {
      return;
    }
    for (const candidate of [...getAncestorAccountPaths(path), path]) {
      if (this.pathSet.has(candidate)) {
        continue;
      }
      this.pathSet.add(candidate);
      const parent = getParentAccountPath(candidate) ?? '';
      let siblings = this.childPathsByParent.get(parent);
      if (siblings == null) {
        siblings = new Set<string>();
        this.childPathsByParent.set(parent, siblings);
      }
      if (parent !== '' && siblings.size === 0) {
        // Leaf → group promotion: the parent never had expansion state, so
        // give it the construction default (expanded).
        this.expandedPaths.add(parent);
      }
      siblings.add(candidate);
      this.expandedPaths.add(candidate);
      added.push(candidate);
    }
  }

  /**
   * Removes the subtree rooted at `path` from the canonical tier (path set,
   * children map, expansion, balances, posting counts), appending every
   * removed path to `removed`. Unknown paths are no-ops.
   */
  private removeSubtree(path: string, removed: string[]): void {
    if (!this.pathSet.has(path)) {
      return;
    }
    this.childPathsByParent.get(getParentAccountPath(path) ?? '')?.delete(path);
    const stack: string[] = [path];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null) {
        break;
      }
      this.pathSet.delete(current);
      this.expandedPaths.delete(current);
      this.childLoadByPath.delete(current);
      this.ownBalancesByPath.delete(current);
      this.postingCountsByPath.delete(current);
      removed.push(current);
      const children = this.childPathsByParent.get(current);
      if (children != null) {
        this.childPathsByParent.delete(current);
        for (const child of children) {
          stack.push(child);
        }
      }
    }
  }

  /** Move precondition checks, in documented priority order. Null = valid. */
  private validateMove(
    fromPath: string,
    toPath: string
  ): AccountMutationRejectionReason | null {
    if (!this.pathSet.has(fromPath)) {
      return 'unknown-source';
    }
    if (!isValidAccountPath(toPath)) {
      return 'invalid-target';
    }
    if (toPath === fromPath || toPath.startsWith(`${fromPath}:`)) {
      return 'target-inside-source';
    }
    if (this.pathSet.has(toPath)) {
      return 'target-exists';
    }
    return null;
  }

  /**
   * Applies a validated move to the canonical tier: enumerates the subtree,
   * re-keys every per-path map entry from old to new path, rewires the
   * children map, and auto-creates missing target ancestors. Appends
   * from→to pairs (subtree root first) to `moved` and auto-created ancestor
   * paths to `added`.
   */
  private moveSubtree(
    fromPath: string,
    toPath: string,
    added: string[],
    moved: Array<{ from: string; to: string }>
  ): void {
    // Auto-create the target's ancestor chain (never inside the source —
    // validateMove rejected that shape already).
    const toParent = getParentAccountPath(toPath);
    if (toParent != null) {
      this.collectPathWithAncestors(toParent, added);
    }

    // Enumerate the old subtree before touching any state.
    const subtree: string[] = [];
    const stack: string[] = [fromPath];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null) {
        break;
      }
      subtree.push(current);
      const children = this.childPathsByParent.get(current);
      if (children != null) {
        for (const child of children) {
          stack.push(child);
        }
      }
    }

    const prefixLength = fromPath.length;
    const remap = (path: string): string => toPath + path.slice(prefixLength);

    // Detach the root from its old parent, then re-key every subtree path.
    // Old children sets are captured first so their keys can be replaced
    // wholesale — every member of a moved children set is itself in the
    // subtree, so members remap with the same prefix substitution.
    this.childPathsByParent
      .get(getParentAccountPath(fromPath) ?? '')
      ?.delete(fromPath);
    const oldChildrenByPath = new Map<string, Set<string>>();
    for (const oldPath of subtree) {
      const children = this.childPathsByParent.get(oldPath);
      if (children != null) {
        oldChildrenByPath.set(oldPath, children);
        this.childPathsByParent.delete(oldPath);
      }
      this.pathSet.delete(oldPath);
    }
    for (const oldPath of subtree) {
      const newPath = remap(oldPath);
      this.pathSet.add(newPath);
      if (this.expandedPaths.delete(oldPath)) {
        this.expandedPaths.add(newPath);
      }
      // Load state follows the moved path like expansion does: a pending
      // subtree renamed mid-flight keeps claiming unfetched children.
      const loadEntry = this.childLoadByPath.get(oldPath);
      if (loadEntry != null) {
        this.childLoadByPath.delete(oldPath);
        this.childLoadByPath.set(newPath, loadEntry);
      }
      const balances = this.ownBalancesByPath.get(oldPath);
      if (balances != null) {
        this.ownBalancesByPath.delete(oldPath);
        this.ownBalancesByPath.set(newPath, balances);
      }
      const postingCount = this.postingCountsByPath.get(oldPath);
      if (postingCount != null) {
        this.postingCountsByPath.delete(oldPath);
        this.postingCountsByPath.set(newPath, postingCount);
      }
      const children = oldChildrenByPath.get(oldPath);
      if (children != null) {
        const remappedChildren = new Set<string>();
        for (const child of children) {
          remappedChildren.add(remap(child));
        }
        this.childPathsByParent.set(newPath, remappedChildren);
      }
      moved.push({ from: oldPath, to: newPath });
    }

    // Attach the moved root under its new parent, promoting a pre-existing
    // leaf parent to an expanded group exactly like collectPathWithAncestors.
    const newParent = toParent ?? '';
    let newSiblings = this.childPathsByParent.get(newParent);
    if (newSiblings == null) {
      newSiblings = new Set<string>();
      this.childPathsByParent.set(newParent, newSiblings);
    }
    if (newParent !== '' && newSiblings.size === 0) {
      this.expandedPaths.add(newParent);
    }
    newSiblings.add(toPath);
  }

  // --- Internals ---------------------------------------------------------------

  /**
   * True when the path is a known account that currently has children — or
   * sits in a pending child-load state (`unloaded`/`loading`/`error`), whose
   * whole meaning is "children exist but are not fetched yet". This is the
   * projection-honesty seam: expansion (`setExpanded`/`isExpanded`) and row
   * materialization both route through group-ness, so a zero-child unloaded
   * path renders as an expandable group with a truthful expand affordance.
   */
  private isGroupPath(path: string): boolean {
    if (!this.pathSet.has(path)) {
      return false;
    }
    const children = this.childPathsByParent.get(path);
    return (
      (children != null && children.size > 0) || this.childLoadByPath.has(path)
    );
  }

  /** Drops both derived tiers after any topology mutation. */
  private markTopologyDirty(): void {
    this.derived = null;
    this.visibleIds = null;
  }

  /**
   * Notifies listeners with an honest account-topology mutation event.
   * `completeChildLoad` passes its transition through `childLoad` so the ONE
   * event carries both halves (children added + machine now `loaded`); the
   * transitioned path joins `accountsChanged` because its own row changes
   * (spinner off) even when the load produced zero new paths.
   */
  private emitTopologyChange(
    topology: AccountTopologyChange,
    childLoad?: AccountChildLoadChange
  ): void {
    const accounts = new Set<string>();
    for (const path of topology.addedPaths) {
      accounts.add(path);
    }
    for (const path of topology.removedPaths) {
      accounts.add(path);
    }
    for (const pair of topology.movedPaths) {
      accounts.add(pair.from);
      accounts.add(pair.to);
    }
    if (childLoad != null) {
      accounts.add(childLoad.path);
    }
    const event: MutationEvent = {
      entriesChanged: [],
      accountsChanged: [...accounts],
      topology,
      ...(childLoad != null ? { childLoad } : {}),
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Rebuilds the derived SoA/CSR tier from the canonical tier when dirty:
   * sorts siblings, assigns DFS-preorder node ids, fills the flat child
   * table, materializes balance columns from the path-keyed maps, and rolls
   * balances up in a single reverse-id pass. This is the ONE rebuild a
   * whole burst of mutations amortizes to.
   */
  private ensureTopology(): DerivedTopology {
    if (this.derived != null) {
      return this.derived;
    }

    // Sort siblings per parent (code-point order on leaf names).
    const sortedChildrenByParent = new Map<string, string[]>();
    for (const [parent, children] of this.childPathsByParent) {
      if (children.size === 0) {
        continue;
      }
      sortedChildrenByParent.set(
        parent,
        [...children].sort(compareSiblingPaths)
      );
    }

    // Assign node ids in DFS preorder so every descendant has a higher id
    // than its ancestors — the property that lets balance roll-up run as a
    // single reverse-id pass with no explicit stack.
    const nodeCount = this.pathSet.size + 1;
    const parentIds = new Int32Array(nodeCount);
    const depths = new Int32Array(nodeCount);
    const firstChildIndexes = new Int32Array(nodeCount);
    const childCounts = new Int32Array(nodeCount);
    const childIdsFlat = new Int32Array(nodeCount - 1);
    const childPositions = new Int32Array(nodeCount);
    const pathsById = new Array<string>(nodeCount);
    const namesById = new Array<string>(nodeCount);
    const idByPath = new Map<string, number>();

    parentIds[ROOT_ID] = -1;
    depths[ROOT_ID] = -1;
    childPositions[ROOT_ID] = -1;
    pathsById[ROOT_ID] = '';
    namesById[ROOT_ID] = '';

    // Iterative preorder walk; children are pushed in reverse so they pop in
    // sorted order.
    let nextId = 1;
    const stack: Array<{ path: string; parentId: number; depth: number }> = [];
    const rootChildren = sortedChildrenByParent.get('') ?? [];
    for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
      stack.push({ path: rootChildren[index], parentId: ROOT_ID, depth: 0 });
    }
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame == null) {
        break;
      }
      const id = nextId;
      nextId += 1;
      parentIds[id] = frame.parentId;
      depths[id] = frame.depth;
      pathsById[id] = frame.path;
      namesById[id] = getAccountLeafName(frame.path);
      idByPath.set(frame.path, id);
      const children = sortedChildrenByParent.get(frame.path);
      if (children != null) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({
            path: children[index],
            parentId: id,
            depth: frame.depth + 1,
          });
        }
      }
    }

    // Fill the CSR child table in id order. Total edge count equals
    // nodeCount - 1 (every node except the root has exactly one parent), so
    // the flat array is sized exactly with no growth copies.
    let edgeCursor = 0;
    for (let id = 0; id < nodeCount; id += 1) {
      firstChildIndexes[id] = edgeCursor;
      const children = sortedChildrenByParent.get(pathsById[id]);
      if (children == null) {
        continue;
      }
      childCounts[id] = children.length;
      for (let position = 0; position < children.length; position += 1) {
        const childId = idByPath.get(children[position]);
        if (childId == null) {
          continue;
        }
        childIdsFlat[edgeCursor] = childId;
        childPositions[childId] = position;
        edgeCursor += 1;
      }
    }

    // Materialize per-currency balance columns and posting counts from the
    // path-keyed maps. Amounts are integers, and Float64Array holds every
    // integer exactly up to 2^53, so sums of safe-integer minor units stay
    // exact here while keeping one dense, GC-free column per currency.
    const ownBalanceColumns = this.currencyCodes.map(
      () => new Float64Array(nodeCount)
    );
    const postingCounts = new Int32Array(nodeCount);
    for (const [path, balances] of this.ownBalancesByPath) {
      const id = idByPath.get(path);
      if (id == null) {
        continue;
      }
      for (const [currency, amount] of balances) {
        const currencyId = this.currencyIdByCode.get(currency);
        if (currencyId != null) {
          ownBalanceColumns[currencyId][id] = amount;
        }
      }
    }
    for (const [path, count] of this.postingCountsByPath) {
      const id = idByPath.get(path);
      if (id != null) {
        postingCounts[id] = count;
      }
    }

    // Rolled-up balances (own + descendants) in a single bottom-up pass:
    // preorder ids guarantee every child is finalized before its parent when
    // walking ids in reverse, so no recursion or explicit stack is needed.
    const rolledBalanceColumns = ownBalanceColumns.map((own) => {
      const rolled = Float64Array.from(own);
      for (let id = nodeCount - 1; id >= 1; id -= 1) {
        rolled[parentIds[id]] += rolled[id];
      }
      return rolled;
    });

    this.derived = {
      nodeCount,
      parentIds,
      depths,
      firstChildIndexes,
      childCounts,
      childIdsFlat,
      childPositions,
      pathsById,
      namesById,
      idByPath,
      ownBalanceColumns,
      rolledBalanceColumns,
      postingCounts,
    };
    return this.derived;
  }

  /**
   * Rebuilds the visible-id list when dirty: a preorder DFS over the CSR
   * child table that only descends into expanded groups. The virtual root
   * contributes no row; top-level accounts are always visible.
   */
  private ensureProjection(): Int32Array {
    const derived = this.ensureTopology();
    if (this.visibleIds != null) {
      return this.visibleIds;
    }
    const visible: number[] = [];
    // Growable number[] stack over the CSR table (max depth = tree height is
    // unknown); ids are pushed in reverse child order to pop in sorted order.
    const stack: number[] = [];
    const rootFirst = derived.firstChildIndexes[ROOT_ID];
    for (let i = derived.childCounts[ROOT_ID] - 1; i >= 0; i -= 1) {
      stack.push(derived.childIdsFlat[rootFirst + i]);
    }
    while (stack.length > 0) {
      const id = stack.pop();
      if (id == null) {
        break;
      }
      visible.push(id);
      if (
        derived.childCounts[id] > 0 &&
        this.expandedPaths.has(derived.pathsById[id])
      ) {
        const first = derived.firstChildIndexes[id];
        for (let i = derived.childCounts[id] - 1; i >= 0; i -= 1) {
          stack.push(derived.childIdsFlat[first + i]);
        }
      }
    }
    this.visibleIds = Int32Array.from(visible);
    return this.visibleIds;
  }

  /** Builds one public AccountRow from derived typed-array state. Pending
   * child-load paths materialize as groups even with zero children — the
   * live-map check keeps row kind honest without a derived rebuild. */
  private materializeRow(derived: DerivedTopology, id: number): AccountRow {
    const isGroup =
      derived.childCounts[id] > 0 ||
      this.childLoadByPath.has(derived.pathsById[id]);
    return {
      path: derived.pathsById[id],
      name: derived.namesById[id],
      depth: derived.depths[id],
      kind: isGroup ? 'group' : 'leaf',
      expanded: isGroup && this.expandedPaths.has(derived.pathsById[id]),
      ownBalances: this.readBalances(derived.ownBalanceColumns, id),
      rolledBalances: this.readBalances(derived.rolledBalanceColumns, id),
      postingCount: derived.postingCounts[id],
      setSize: derived.childCounts[derived.parentIds[id]],
      posInSet: derived.childPositions[id] + 1,
    };
  }

  /**
   * Reads one node's balances out of the per-currency columns into a small
   * Map, omitting zero balances so absence always means zero. The column
   * values are exact integers (see ensureTopology), so the Map holds true
   * MinorUnits.
   */
  private readBalances(
    columns: readonly Float64Array[],
    id: number
  ): Map<string, MinorUnits> {
    const balances = new Map<string, MinorUnits>();
    for (
      let currencyId = 0;
      currencyId < this.currencyCodes.length;
      currencyId += 1
    ) {
      const amount = columns[currencyId][id];
      if (amount !== 0) {
        balances.set(this.currencyCodes[currencyId], amount);
      }
    }
    return balances;
  }
}
