// Chart-of-accounts tree engine. Built once from entries and/or explicit
// account paths; topology is immutable after construction (rebuild the store
// when the account set changes), while expansion state and the derived
// visible projection are mutable.
//
// Storage is Struct-of-Arrays: one parallel Int32Array per hot node field
// plus a flat CSR (compressed-sparse-row) child table. A plain object per
// account would pay object-header overhead, pointer chasing, and a
// fragmented GC tail on 10k+ account charts; dense typed arrays keep the
// bottom-up balance sweep and the visible-projection DFS cache-friendly.
// String data (segment names, full paths) lives in plain arrays indexed by
// node id — strings are only touched when a row is materialized for a
// viewport-sized slice, never during sweeps.
//
// Canonical colon-delimited paths are the only account identity at the
// public boundary; numeric node ids never leak out.

import {
  getAccountLeafName,
  getAncestorAccountPaths,
  getParentAccountPath,
  isValidAccountPath,
} from './accountPath';
import type { AccountRow, AccountStoreOptions, MinorUnits } from './types';

// Node id 0 is a virtual root that parents every top-level account; it never
// appears in the visible projection and has no path.
const ROOT_ID = 0;

export class AccountStore {
  // --- Immutable topology (filled once in the constructor) -----------------

  /** Total node slots including the virtual root. */
  private readonly nodeCount: number;
  /** Parallel per-node fields, indexed by node id. */
  private readonly parentIds: Int32Array;
  private readonly depths: Int32Array;
  /**
   * CSR child table: the children of node `id` occupy
   * `childIdsFlat[firstChildIndexes[id] .. firstChildIndexes[id] + childCounts[id])`.
   * Leaves have `childCounts[id] === 0`.
   */
  private readonly firstChildIndexes: Int32Array;
  private readonly childCounts: Int32Array;
  private readonly childIdsFlat: Int32Array;
  /**
   * A node's zero-based position within its parent's (sorted) children.
   * Precomputed so slice reads derive aria posInSet without scanning
   * siblings.
   */
  private readonly childPositions: Int32Array;
  /** Full canonical path and leaf name per node id ('' for the root). */
  private readonly pathsById: string[];
  private readonly namesById: string[];
  private readonly idByPath: Map<string, number>;

  // --- Immutable balances (single bottom-up pass in the constructor) -------

  /** Currency codes in first-seen order; index = currency id. */
  private readonly currencyCodes: string[];
  /**
   * Per-currency balance columns, indexed [currencyId][nodeId]. Amounts are
   * integers, and Float64Array holds every integer exactly up to 2^53
   * (Number.MAX_SAFE_INTEGER), so sums of safe-integer minor units stay
   * exact here while keeping one dense, GC-free column per currency.
   */
  private readonly ownBalanceColumns: Float64Array[];
  private readonly rolledBalanceColumns: Float64Array[];
  /** Number of postings directly on each account. */
  private readonly postingCounts: Int32Array;

  // --- Mutable expansion state + lazily rebuilt projection ------------------

  /** Group node ids currently expanded. Leaves never appear here. */
  private readonly expandedIds: Set<number>;
  /**
   * Visible node ids in render order, or null when expansion changed since
   * the last read (dirty flag). Rebuilt lazily so a burst of setExpanded
   * calls pays for one projection rebuild, not one per call.
   */
  private visibleIds: Int32Array | null;

  constructor(options: AccountStoreOptions = {}) {
    const { entries = [], accountPaths = [] } = options;

    // Collect every valid account path plus all implied ancestors. Invalid
    // paths (empty, doubled colons) are skipped silently: this ingests
    // user-authored ledger data and must not throw.
    const allPaths = new Set<string>();
    const collectPath = (path: string): void => {
      if (!isValidAccountPath(path) || allPaths.has(path)) {
        return;
      }
      allPaths.add(path);
      for (const ancestor of getAncestorAccountPaths(path)) {
        allPaths.add(ancestor);
      }
    };
    for (const entry of entries) {
      for (const posting of entry.postings) {
        collectPath(posting.account);
      }
    }
    for (const path of accountPaths) {
      collectPath(path);
    }

    // Group child paths under their parent ('' keys the virtual root) and
    // sort siblings by leaf name (plain code-point order for determinism
    // across runtimes and locales).
    const childPathsByParent = new Map<string, string[]>();
    for (const path of allPaths) {
      const parent = getParentAccountPath(path) ?? '';
      const siblings = childPathsByParent.get(parent);
      if (siblings == null) {
        childPathsByParent.set(parent, [path]);
      } else {
        siblings.push(path);
      }
    }
    for (const siblings of childPathsByParent.values()) {
      siblings.sort((a, b) => {
        const leafA = getAccountLeafName(a);
        const leafB = getAccountLeafName(b);
        return leafA < leafB ? -1 : leafA > leafB ? 1 : 0;
      });
    }

    // Assign node ids in DFS preorder so every descendant has a higher id
    // than its ancestors — the property that lets balance roll-up run as a
    // single reverse-id pass with no explicit stack.
    const nodeCount = allPaths.size + 1;
    this.nodeCount = nodeCount;
    this.parentIds = new Int32Array(nodeCount);
    this.depths = new Int32Array(nodeCount);
    this.firstChildIndexes = new Int32Array(nodeCount);
    this.childCounts = new Int32Array(nodeCount);
    this.childIdsFlat = new Int32Array(nodeCount - 1);
    this.childPositions = new Int32Array(nodeCount);
    this.pathsById = new Array<string>(nodeCount);
    this.namesById = new Array<string>(nodeCount);
    this.idByPath = new Map<string, number>();

    this.parentIds[ROOT_ID] = -1;
    this.depths[ROOT_ID] = -1;
    this.childPositions[ROOT_ID] = -1;
    this.pathsById[ROOT_ID] = '';
    this.namesById[ROOT_ID] = '';

    // Iterative preorder walk; children are pushed in reverse so they pop in
    // sorted order.
    let nextId = 1;
    const stack: Array<{ path: string; parentId: number; depth: number }> = [];
    const rootChildren = childPathsByParent.get('') ?? [];
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
      this.parentIds[id] = frame.parentId;
      this.depths[id] = frame.depth;
      this.pathsById[id] = frame.path;
      this.namesById[id] = getAccountLeafName(frame.path);
      this.idByPath.set(frame.path, id);
      const children = childPathsByParent.get(frame.path);
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
      this.firstChildIndexes[id] = edgeCursor;
      const children = childPathsByParent.get(this.pathsById[id]);
      if (children == null) {
        continue;
      }
      this.childCounts[id] = children.length;
      for (let position = 0; position < children.length; position += 1) {
        const childId = this.idByPath.get(children[position]);
        if (childId == null) {
          continue;
        }
        this.childIdsFlat[edgeCursor] = childId;
        this.childPositions[childId] = position;
        edgeCursor += 1;
      }
    }

    // Accumulate own balances and posting counts from entry postings.
    // Postings with invalid accounts or unsafe amounts are skipped — same
    // graceful-degradation contract as path collection above.
    this.currencyCodes = [];
    this.ownBalanceColumns = [];
    this.postingCounts = new Int32Array(nodeCount);
    const currencyIdByCode = new Map<string, number>();
    for (const entry of entries) {
      for (const posting of entry.postings) {
        const id = this.idByPath.get(posting.account);
        if (id == null || !Number.isSafeInteger(posting.amount)) {
          continue;
        }
        let currencyId = currencyIdByCode.get(posting.currency);
        if (currencyId == null) {
          currencyId = this.currencyCodes.length;
          currencyIdByCode.set(posting.currency, currencyId);
          this.currencyCodes.push(posting.currency);
          this.ownBalanceColumns.push(new Float64Array(nodeCount));
        }
        this.ownBalanceColumns[currencyId][id] += posting.amount;
        this.postingCounts[id] += 1;
      }
    }

    // Rolled-up balances (own + descendants) in a single bottom-up pass:
    // preorder ids guarantee every child is finalized before its parent when
    // walking ids in reverse, so no recursion or explicit stack is needed.
    this.rolledBalanceColumns = this.ownBalanceColumns.map((own) => {
      const rolled = Float64Array.from(own);
      for (let id = nodeCount - 1; id >= 1; id -= 1) {
        rolled[this.parentIds[id]] += rolled[id];
      }
      return rolled;
    });

    // Default expansion: fully expanded. A chart of accounts is usually
    // browsed whole; callers wanting a collapsed initial view call
    // collapseAll() before the first read.
    this.expandedIds = new Set<number>();
    for (let id = 0; id < nodeCount; id += 1) {
      if (this.childCounts[id] > 0) {
        this.expandedIds.add(id);
      }
    }
    this.visibleIds = null;
  }

  // --- Account lookups -------------------------------------------------------

  /** Number of accounts in the store (implied ancestors included). */
  getAccountCount(): number {
    return this.nodeCount - 1;
  }

  /** True when the canonical path names an account known to this store. */
  hasAccount(path: string): boolean {
    return this.idByPath.has(path);
  }

  /**
   * Balance of postings directly on the account, per currency (zero
   * balances omitted). Returns null for unknown paths.
   */
  getOwnBalances(path: string): Map<string, MinorUnits> | null {
    const id = this.idByPath.get(path);
    return id == null ? null : this.readBalances(this.ownBalanceColumns, id);
  }

  /**
   * Rolled-up balance (own + all descendants) per currency (zero balances
   * omitted). Returns null for unknown paths.
   */
  getRolledBalances(path: string): Map<string, MinorUnits> | null {
    const id = this.idByPath.get(path);
    return id == null ? null : this.readBalances(this.rolledBalanceColumns, id);
  }

  /** Postings directly on the account; 0 for unknown paths. */
  getPostingCount(path: string): number {
    const id = this.idByPath.get(path);
    return id == null ? 0 : this.postingCounts[id];
  }

  // --- Expansion state ---------------------------------------------------------

  /** True when the path names a currently expanded group. */
  isExpanded(path: string): boolean {
    const id = this.idByPath.get(path);
    return id != null && this.expandedIds.has(id);
  }

  /**
   * Expands or collapses one group. No-op for unknown paths and for leaves
   * (graceful degradation), and the projection dirty flag is only set when
   * the state actually changes.
   */
  setExpanded(path: string, expanded: boolean): void {
    const id = this.idByPath.get(path);
    if (id == null || this.childCounts[id] === 0) {
      return;
    }
    if (expanded) {
      if (!this.expandedIds.has(id)) {
        this.expandedIds.add(id);
        this.visibleIds = null;
      }
    } else if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
      this.visibleIds = null;
    }
  }

  /** Expands every group in the tree. */
  expandAll(): void {
    for (let id = 0; id < this.nodeCount; id += 1) {
      if (this.childCounts[id] > 0) {
        this.expandedIds.add(id);
      }
    }
    this.visibleIds = null;
  }

  /** Collapses every group; only top-level accounts remain visible. */
  collapseAll(): void {
    this.expandedIds.clear();
    this.visibleIds = null;
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
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.min(visible.length, Math.floor(end));
    const rows: AccountRow[] = [];
    for (let index = clampedStart; index < clampedEnd; index += 1) {
      rows.push(this.materializeRow(visible[index]));
    }
    return rows;
  }

  // --- Internals ---------------------------------------------------------------

  /**
   * Rebuilds the visible-id list when dirty: a preorder DFS over the CSR
   * child table that only descends into expanded groups. The virtual root
   * contributes no row; top-level accounts are always visible.
   */
  private ensureProjection(): Int32Array {
    if (this.visibleIds != null) {
      return this.visibleIds;
    }
    const visible: number[] = [];
    // Manual Int32Array stack over the CSR table (max depth = tree height is
    // unknown, so a growable number[] stack keeps this simple; ids are
    // pushed in reverse child order to pop in sorted order).
    const stack: number[] = [];
    const rootFirst = this.firstChildIndexes[ROOT_ID];
    for (let i = this.childCounts[ROOT_ID] - 1; i >= 0; i -= 1) {
      stack.push(this.childIdsFlat[rootFirst + i]);
    }
    while (stack.length > 0) {
      const id = stack.pop();
      if (id == null) {
        break;
      }
      visible.push(id);
      if (this.childCounts[id] > 0 && this.expandedIds.has(id)) {
        const first = this.firstChildIndexes[id];
        for (let i = this.childCounts[id] - 1; i >= 0; i -= 1) {
          stack.push(this.childIdsFlat[first + i]);
        }
      }
    }
    this.visibleIds = Int32Array.from(visible);
    return this.visibleIds;
  }

  /** Builds one public AccountRow from internal typed-array state. */
  private materializeRow(id: number): AccountRow {
    const isGroup = this.childCounts[id] > 0;
    return {
      path: this.pathsById[id],
      name: this.namesById[id],
      depth: this.depths[id],
      kind: isGroup ? 'group' : 'leaf',
      expanded: isGroup && this.expandedIds.has(id),
      ownBalances: this.readBalances(this.ownBalanceColumns, id),
      rolledBalances: this.readBalances(this.rolledBalanceColumns, id),
      postingCount: this.postingCounts[id],
      setSize: this.childCounts[this.parentIds[id]],
      posInSet: this.childPositions[id] + 1,
    };
  }

  /**
   * Reads one node's balances out of the per-currency columns into a small
   * Map, omitting zero balances so absence always means zero. The column
   * values are exact integers (see ownBalanceColumns doc), so the Map holds
   * true MinorUnits.
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
