// Framework-free model for the account tree. Wraps @cynco/ledger-store's
// AccountStore (the private engine, inlined into dist at build time): the
// store owns topology, balances, expansion state, and the visible projection;
// this controller layers everything view-shaped on top — selection, focus,
// search sessions, status decorations, density-driven virtualization math,
// and honest change events.

import {
  AccountStore,
  getAccountLeafName,
  getAncestorAccountPaths,
  getParentAccountPath,
  isValidAccountPath,
} from '@cynco/ledger-store';

import {
  DEFAULT_CURRENCY,
  DEFAULT_OVERSCAN_ROWS,
  DENSITY_ROW_HEIGHTS,
} from '../constants';
import type {
  AccountChildLoadPlaceholder,
  AccountChildLoadState,
  AccountDropCollision,
  AccountMove,
  AccountMoveListener,
  AccountMovePlan,
  AccountRenameListener,
  AccountSearchMatchState,
  AccountSearchResult,
  AccountStatusEntry,
  AccountStatusKind,
  AccountTreeChange,
  AccountTreeChangeListener,
  AccountTreeControllerOptions,
  AccountTreeDensity,
  AccountTreeRowData,
  AccountTreeSearchMode,
  BeginSearchOptions,
  LedgerEntry,
  Posting,
  RenameResult,
  RowRange,
  SelectPathOptions,
} from '../types';
import {
  isChildLoadPlaceholderPath,
  makeChildLoadPlaceholderPath,
} from './childLoadPlaceholder';

// Severity order for status roll-up onto ancestors: a group containing both
// pending and flagged descendants shows the flagged (danger) dot.
const STATUS_SEVERITY: Readonly<Record<AccountStatusKind, number>> = {
  pending: 0,
  unreconciled: 1,
  flagged: 2,
};

/** Aggregate for one path's effective status decoration. */
export interface StatusAggregate {
  status: AccountStatusKind;
  count: number;
}

/** Active search session: the query plus the expansion snapshot to restore. */
interface SearchSession {
  query: string;
  /** How the session reshapes the tree (see AccountTreeSearchMode). */
  mode: AccountTreeSearchMode;
  /** Group paths that were expanded when the session began. */
  priorExpandedGroups: readonly string[];
}

const NO_CHANGE: AccountTreeChange = {
  expansionChanged: false,
  selectionChanged: false,
  statusChanged: false,
  focusChanged: false,
  renameChanged: false,
  searchChanged: false,
};

/**
 * One row of the controller-owned visible projection. The projection layers
 * flattening on top of the store's expansion state, so `path` names the row's
 * identity node (the deepest group of a flattened chain) while `depth` and
 * the aria fields describe the row's place in the *visible* projection.
 */
interface ProjectionRow {
  path: string;
  name: string;
  depth: number;
  kind: 'group' | 'leaf';
  posInSet: number;
  setSize: number;
  flattenedNames: readonly string[] | null;
  /**
   * Present only on synthetic child-load placeholder rows (the loading /
   * error row under an expanded pending group); `path` then carries the
   * non-path projection marker from makeChildLoadPlaceholderPath.
   */
  loadPlaceholder?: AccountChildLoadPlaceholder;
}

/** One snapshotted child-load machine entry carried across store rebuilds. */
interface ChildLoadSnapshotEntry {
  path: string;
  state: AccountChildLoadState;
  error: string | null;
  expanded: boolean;
}

export class AccountTreeController {
  private store: AccountStore;
  /** Every canonical account path in the store, implied ancestors included. */
  private allPaths: string[] = [];
  /** Paths that have at least one child (expandable groups). */
  private groupPaths: Set<string> = new Set();
  /**
   * Children per parent path ('' keys the roots), sorted by leaf name in the
   * same code-point order the store sorts siblings. Drives the controller's
   * own projection walk (which the flatten feature reshapes) and the aria
   * posinset/setsize values under flattening.
   */
  private childrenByParent = new Map<string, string[]>();

  private density: AccountTreeDensity;
  private readonly currency: string;
  private readonly showBalances: boolean;
  private flattenEmptyGroups: boolean;
  private accounts: readonly string[];
  /** Retained so path remaps (rename, drag & drop) can rebuild balances. */
  private entries: readonly LedgerEntry[];

  private readonly selection = new Set<string>();
  /** Anchor for shift-range selection: the last non-range selected path. */
  private selectionAnchor: string | null = null;
  private focusedPath: string | null = null;

  /** Own status decorations keyed by path, exactly as passed in. */
  private ownStatus = new Map<string, StatusAggregate>();
  /** Rolled-up decorations on ancestor paths (own + descendants). */
  private rolledStatus = new Map<string, StatusAggregate>();

  private searchSession: SearchSession | null = null;
  private searchMatches = new Set<string>();
  /**
   * Projection overlay for `hide-non-matches`: the set of paths allowed to
   * own visible rows (matches plus their ancestors), or null when no filter
   * applies (other modes, no session, or an empty match set — filtering
   * everything away on a miss would leave the user staring at a void).
   * Precomputed once per query so the projection walk does set lookups, not
   * per-row subtree scans.
   */
  private searchVisibleFilter: Set<string> | null = null;

  /** Async child loader (lazy subtrees), or null when not configured. */
  private readonly loadChildren:
    | ((path: string) => Promise<readonly string[]>)
    | null;
  private readonly onChildLoadError:
    | ((path: string, error: unknown) => void)
    | null;
  /**
   * Stale-response gate for in-flight child loads: one token per attempt,
   * keyed by path — the same identity-token idiom as the view's context-menu
   * session. A settlement only applies while its token is still the path's
   * CURRENT token; retries, remaps of the path, removals, and
   * cancelChildLoads all invalidate it, so late responses are discarded
   * instead of resurrecting rows for a tree that moved on.
   */
  private readonly childLoadTokens = new Map<string, number>();
  private childLoadTokenCounter = 0;

  /** Path currently being renamed inline, or null. */
  private renamingPath: string | null = null;
  /**
   * Live rename input draft. Owned by the controller (not the DOM input) so
   * the in-progress value survives the input being destroyed and recreated
   * when its row leaves and re-enters the virtualization window.
   */
  private renameDraft = '';

  /**
   * Visible projection (flatten-aware) in render order plus a reverse
   * path→index map, rebuilt lazily after expansion/topology changes.
   * Keyboard navigation, range selection, and sticky ancestor lookup all
   * need the mapping; caching it means one O(n) rebuild per change instead
   * of one scan per keystroke.
   */
  private projectionCache: ProjectionRow[] | null = null;
  private visiblePathsCache: string[] | null = null;
  private visibleIndexByPath = new Map<string, number>();

  private readonly listeners = new Set<AccountTreeChangeListener>();
  private readonly renameListeners = new Set<AccountRenameListener>();
  private readonly moveListeners = new Set<AccountMoveListener>();

  constructor(options: AccountTreeControllerOptions = {}) {
    const {
      entries = [],
      accounts = [],
      initialExpansion = 'all',
      density = 'default',
      currency = DEFAULT_CURRENCY,
      showBalances = true,
      flattenEmptyGroups = false,
      loadChildren = null,
      initiallyUnloaded = [],
      onChildLoadError = null,
    } = options;
    this.density = density;
    this.currency = currency;
    this.showBalances = showBalances;
    this.flattenEmptyGroups = flattenEmptyGroups;
    this.loadChildren = loadChildren;
    this.onChildLoadError = onChildLoadError;
    this.accounts = accounts;
    this.entries = entries;
    this.store = this.buildStore(entries, accounts);
    // Mark BEFORE initial expansion: marking collapses the paths (children
    // unknown), and the expansion modes leave zero-child groups alone —
    // initial expansion never triggers loads, only expand gestures do.
    this.store.markUnloaded([...initiallyUnloaded]);
    this.applyInitialExpansion(initialExpansion);
  }

  // --- Data ------------------------------------------------------------------

  /**
   * Rebuilds the store from new entries (topology is immutable inside the
   * engine, so data changes mean a rebuild). Collapsed groups, selection,
   * and focus survive for paths that still exist; brand-new groups default
   * to expanded, matching the store's browse-whole default.
   */
  setEntries(entries: readonly LedgerEntry[]): void {
    const collapsedGroups: string[] = [];
    for (const path of this.groupPaths) {
      if (!this.store.isExpanded(path)) {
        collapsedGroups.push(path);
      }
    }
    const childLoadSnapshot = this.snapshotChildLoadStates();

    this.entries = entries;
    this.store = this.buildStore(entries, this.accounts);
    for (const path of collapsedGroups) {
      this.store.setExpanded(path, false);
    }
    // Load state lives in the store, which was just replaced: re-apply it
    // for surviving paths (identity map — setEntries moves nothing), so
    // in-flight loads stay valid and pending groups keep their affordance.
    this.restoreChildLoadStates(childLoadSnapshot, (path) =>
      this.store.hasAccount(path) ? path : null
    );

    let selectionChanged = false;
    for (const path of [...this.selection]) {
      if (!this.store.hasAccount(path)) {
        this.selection.delete(path);
        selectionChanged = true;
      }
    }
    let focusChanged = false;
    if (this.focusedPath != null && !this.store.hasAccount(this.focusedPath)) {
      this.focusedPath = null;
      focusChanged = true;
    }
    if (
      this.selectionAnchor != null &&
      !this.store.hasAccount(this.selectionAnchor)
    ) {
      this.selectionAnchor = null;
    }
    // Re-derive status roll-up against the new topology (own entries keep
    // decorating paths that survived; vanished paths stop contributing).
    this.rebuildStatusRollup();

    this.invalidateVisibleCache();
    this.emit({
      ...NO_CHANGE,
      expansionChanged: true,
      selectionChanged,
      focusChanged,
      statusChanged: true,
    });
  }

  /** Number of accounts in the tree (implied ancestors included). */
  getAccountCount(): number {
    return this.store.getAccountCount();
  }

  /** True when the canonical path names an account known to the tree. */
  hasAccount(path: string): boolean {
    return this.store.hasAccount(path);
  }

  // --- Density / virtualization math -------------------------------------------

  getDensity(): AccountTreeDensity {
    return this.density;
  }

  setDensity(density: AccountTreeDensity): void {
    this.density = density;
  }

  /** Fixed pixel row height for the current density preset. */
  getRowHeight(): number {
    return DENSITY_ROW_HEIGHTS[this.density];
  }

  /** Total pixel height of the fully laid out visible projection. */
  getTotalHeight(): number {
    return this.getVisibleCount() * this.getRowHeight();
  }

  /**
   * Maps a pixel scroll window onto the half-open `[start, end)` row range
   * that should have real DOM, expanded by `overscan` rows on both sides and
   * clamped to the projection. Pure arithmetic — fixed row heights mean no
   * per-row measurement anywhere.
   */
  getVisibleRange(
    scrollTop: number,
    viewportHeight: number,
    overscan: number = DEFAULT_OVERSCAN_ROWS
  ): RowRange {
    const rowHeight = this.getRowHeight();
    const count = this.getVisibleCount();
    if (count <= 0 || viewportHeight <= 0) {
      return { start: 0, end: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(
      count,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
    );
    return { start: Math.min(start, count), end: Math.max(end, start) };
  }

  // --- Row reads -----------------------------------------------------------------

  /** Number of rows currently visible given the expansion state. */
  getVisibleCount(): number {
    return this.ensureProjection().length;
  }

  /**
   * Materializes decoration-complete rows for the half-open `[start, end)`
   * range: the projection's per-row data plus selection, focus, search-match,
   * and effective status, with the rolled balance extracted in the primary
   * display currency. Slices are viewport-sized, so allocation stays bounded.
   */
  getRows(start: number, end: number): AccountTreeRowData[] {
    const projection = this.ensureProjection();
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.min(projection.length, Math.floor(end));
    const decorated: AccountTreeRowData[] = [];
    for (let index = clampedStart; index < clampedEnd; index += 1) {
      const row = projection[index];
      // Placeholder rows carry no account state: every decoration facet is
      // inert, only depth (indent) and the placeholder payload matter.
      if (row.loadPlaceholder != null) {
        decorated.push({
          path: row.path,
          name: '',
          depth: row.depth,
          kind: 'leaf',
          expanded: false,
          setSize: 0,
          posInSet: 0,
          balance: null,
          selected: false,
          focused: false,
          searchMatch: false,
          status: null,
          statusCount: 0,
          flattenedNames: null,
          visibleChildCount: 0,
          childLoadState: 'loaded',
          loadPlaceholder: row.loadPlaceholder,
        });
        continue;
      }
      const isGroup = row.kind === 'group';
      const expanded = isGroup && this.store.isExpanded(row.path);
      const status = this.getEffectiveStatus(row.path, isGroup, expanded);
      decorated.push({
        path: row.path,
        name: row.name,
        depth: row.depth,
        kind: row.kind,
        expanded,
        setSize: row.setSize,
        posInSet: row.posInSet,
        balance: this.showBalances
          ? (this.store.getRolledBalances(row.path)?.get(this.currency) ?? null)
          : null,
        selected: this.selection.has(row.path),
        focused: this.focusedPath === row.path,
        searchMatch: this.searchMatches.has(row.path),
        status: status?.status ?? null,
        statusCount: status?.count ?? 0,
        flattenedNames: row.flattenedNames,
        visibleChildCount: expanded ? this.getAdmittedChildCount(row.path) : 0,
        childLoadState: isGroup
          ? this.store.getChildLoadState(row.path).state
          : 'loaded',
        loadPlaceholder: null,
      });
    }
    return decorated;
  }

  /**
   * Direct children of a path that the visible projection admits: all of
   * them normally, only the match/ancestor set under a `hide-non-matches`
   * filter. O(1) without a filter, O(children) with one — a per-row cost the
   * projection walk itself already pays, never a subtree scan.
   */
  private getAdmittedChildCount(path: string): number {
    const children = this.childrenByParent.get(path);
    if (children == null) {
      return 0;
    }
    const filter = this.searchVisibleFilter;
    if (filter == null) {
      return children.length;
    }
    let count = 0;
    for (const child of children) {
      if (filter.has(child)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Decorated row for one currently visible path, or null when the path is
   * unknown or hidden by a collapsed ancestor. Used for the sticky ancestor
   * mirror row (ancestors of a visible row are always visible themselves).
   */
  getRow(path: string): AccountTreeRowData | null {
    const index = this.getPathIndex(path);
    if (index < 0) {
      return null;
    }
    const rows = this.getRows(index, index + 1);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Visible paths in render order (cached; do not mutate). Child-load
   * placeholder rows occupy their index with a synthetic non-path marker
   * (see childLoadPlaceholder.ts) so row indexes stay aligned with the
   * rendered grid; `isChildLoadPlaceholderPath` identifies them, and every
   * account API treats the marker as an unknown path (graceful no-op).
   */
  getVisiblePaths(): readonly string[] {
    this.ensureProjection();
    return this.visiblePathsCache ?? [];
  }

  /** Index of a path in the visible projection, or -1 when hidden/unknown. */
  getPathIndex(path: string): number {
    this.ensureProjection();
    return this.visibleIndexByPath.get(path) ?? -1;
  }

  /**
   * Nearest ancestor of a path that owns a row in the visible projection, or
   * null. Under `flattenEmptyGroups`, mid-chain ancestors have no row of
   * their own, so "jump to parent" and the sticky mirror must walk up until
   * they find the flattened row that actually represents the chain.
   */
  getVisibleParentPath(path: string): string | null {
    const ancestors = getAncestorAccountPaths(path);
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
      if (this.getPathIndex(ancestors[index]) >= 0) {
        return ancestors[index];
      }
    }
    return null;
  }

  /**
   * Every ancestor of a path that owns a row in the visible projection, in
   * root-first order. The chain the sticky ancestor stack renders: one O(1)
   * index lookup per canonical ancestor, so flattening and hide-non-matches
   * (whose mid-chain ancestors own no row) fall out for free — the same
   * visible-parent rule as `getVisibleParentPath`, extended to the full
   * chain in a single O(depth) pass.
   */
  getVisibleAncestorPaths(path: string): string[] {
    const visibleAncestors: string[] = [];
    for (const ancestor of getAncestorAccountPaths(path)) {
      if (this.getPathIndex(ancestor) >= 0) {
        visibleAncestors.push(ancestor);
      }
    }
    return visibleAncestors;
  }

  // --- Flattening -----------------------------------------------------------------

  getFlattenEmptyGroups(): boolean {
    return this.flattenEmptyGroups;
  }

  /**
   * Toggles single-child group-chain flattening at runtime. Purely a
   * projection change — canonical topology and expansion state are
   * untouched — so switching back restores the exact previous tree.
   */
  setFlattenEmptyGroups(value: boolean): void {
    if (this.flattenEmptyGroups === value) {
      return;
    }
    this.flattenEmptyGroups = value;
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  // --- Expansion --------------------------------------------------------------------

  isExpanded(path: string): boolean {
    return this.store.isExpanded(path);
  }

  setExpanded(path: string, expanded: boolean): void {
    if (this.store.isExpanded(path) === expanded) {
      return;
    }
    this.store.setExpanded(path, expanded);
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
    // Expanding an unloaded group IS the fetch gesture (chevron click,
    // ArrowRight, programmatic reveal all funnel through here). Error groups
    // deliberately do NOT auto-retry on re-expand — retry is the explicit
    // button, so collapsing/expanding never hammers a failing endpoint.
    if (
      expanded &&
      this.loadChildren != null &&
      this.store.getChildLoadState(path).state === 'unloaded'
    ) {
      this.requestChildLoad(path);
    }
  }

  /**
   * Expands every group with known children. Unloaded groups are skipped by
   * design: expand-all is ONE gesture, and letting it fan out N network
   * fetches (one per unloaded group) would be surprising, slow, and
   * unbounded — the user expands the specific group they want fetched.
   */
  expandAll(): void {
    this.store.expandAll();
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  collapseAll(): void {
    this.store.collapseAll();
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  /**
   * Expands every ancestor of a path so the path itself becomes visible
   * (scroll-to-path needs the target row to exist in the projection). Emits
   * a single change event only when at least one ancestor actually opened.
   */
  revealPath(path: string): void {
    let changed = false;
    for (const ancestor of getAncestorAccountPaths(path)) {
      if (!this.store.isExpanded(ancestor)) {
        this.store.setExpanded(ancestor, true);
        changed = true;
      }
    }
    if (changed) {
      this.invalidateVisibleCache();
      this.emit({ ...NO_CHANGE, expansionChanged: true });
    }
  }

  // --- Child loading (lazy subtrees) ---------------------------------------------------

  /**
   * Declares the paths' children as not yet fetched. Marked paths render as
   * collapsed, expandable groups; the next expand gesture triggers
   * `loadChildren`. Unknown paths are ignored. Re-marking a path with a
   * load in flight cancels that load (its settlement is discarded).
   */
  markUnloaded(paths: readonly string[]): void {
    this.store.markUnloaded(paths);
    for (const path of paths) {
      // Any in-flight attempt for a re-marked path is stale by definition.
      this.childLoadTokens.delete(path);
    }
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  /** Where the path sits in the child-loading machine (`loaded` default). */
  getChildLoadState(path: string): {
    state: AccountChildLoadState;
    error?: string;
  } {
    return this.store.getChildLoadState(path);
  }

  /**
   * Starts (or retries) the async child load for a path: transitions the
   * store machine to `loading`, renders the placeholder row (the group is
   * usually already expanded by the triggering gesture), and awaits
   * `loadChildren`. Returns false as a no-op when no loader is configured
   * or the path is not in a loadable state (`unloaded`/`error`) — exactly
   * one load runs per path at a time, so one gesture means one fetch.
   */
  requestChildLoad(path: string): boolean {
    const loader = this.loadChildren;
    if (loader == null || !this.store.beginChildLoad(path)) {
      return false;
    }
    const token = (this.childLoadTokenCounter += 1);
    this.childLoadTokens.set(path, token);
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
    // The loader is invoked synchronously (one gesture = one observable
    // fetch, no microtask indirection); a synchronously-throwing loader
    // folds into the rejection path, so a buggy host callback degrades to
    // the error row instead of blowing up the expand gesture.
    let pending: Promise<readonly string[]>;
    try {
      pending = Promise.resolve(loader(path));
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(
      (children) => {
        this.settleChildLoad(path, token, [...(children ?? [])]);
      },
      (error: unknown) => {
        this.settleChildLoadFailure(path, token, error);
      }
    );
    return true;
  }

  /**
   * Invalidates every in-flight child load and resets their machines to
   * `unloaded` (a later mount can re-trigger them with a fresh gesture).
   * The view calls this from `cleanUp` so a load resolving after teardown
   * is discarded instead of mutating a tree nobody renders.
   */
  cancelChildLoads(): void {
    if (this.childLoadTokens.size === 0) {
      return;
    }
    // markUnloaded is the store's force-reset: the machine leaves `loading`,
    // so even the store refuses the stale completion independently of the
    // token gate.
    this.store.markUnloaded([...this.childLoadTokens.keys()]);
    this.childLoadTokens.clear();
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  /** Applies a resolved load, unless a newer attempt superseded it. */
  private settleChildLoad(
    path: string,
    token: number,
    children: string[]
  ): void {
    if (this.childLoadTokens.get(path) !== token) {
      return; // Stale: retried, remapped, removed, or cancelled meanwhile.
    }
    this.childLoadTokens.delete(path);
    const result = this.store.completeChildLoad(path, children);
    if (!result.ok) {
      return; // The store machine refused (e.g. force-reset raced us).
    }
    this.absorbLoadedPaths(result.added);
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  /** Applies a rejected load, unless a newer attempt superseded it. */
  private settleChildLoadFailure(
    path: string,
    token: number,
    error: unknown
  ): void {
    if (this.childLoadTokens.get(path) !== token) {
      return;
    }
    this.childLoadTokens.delete(path);
    this.store.failChildLoad(
      path,
      error instanceof Error ? error.message : String(error)
    );
    this.onChildLoadError?.(path, error);
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  /**
   * Folds paths created by a completed child load into the controller's own
   * topology mirrors (allPaths / groupPaths / childrenByParent) AND into
   * `this.accounts`, so the next full rebuild (rename, drop, setEntries)
   * reconstructs the loaded subtree instead of silently dropping it.
   * O(added × siblings log siblings) — a per-load cost, never per-render.
   */
  private absorbLoadedPaths(added: readonly string[]): void {
    if (added.length === 0) {
      return;
    }
    for (const path of added) {
      this.allPaths.push(path);
      const parent = getParentAccountPath(path) ?? '';
      if (parent !== '') {
        this.groupPaths.add(parent);
      }
      const siblings = this.childrenByParent.get(parent);
      if (siblings == null) {
        this.childrenByParent.set(parent, [path]);
      } else {
        siblings.push(path);
        // Keep the store's sibling order (code-point order on leaf names).
        siblings.sort((a, b) => {
          const leafA = getAccountLeafName(a);
          const leafB = getAccountLeafName(b);
          return leafA < leafB ? -1 : leafA > leafB ? 1 : 0;
        });
      }
    }
    this.accounts = [...this.accounts, ...added];
  }

  /**
   * Snapshot half of the rebuild carry: every path with a pending load
   * state, plus its expansion (markUnloaded collapses on re-apply, which
   * must not lose an expanded loading group's placeholder). O(paths) — the
   * rebuilds that need it are already O(paths).
   */
  private snapshotChildLoadStates(): ChildLoadSnapshotEntry[] {
    const snapshot: ChildLoadSnapshotEntry[] = [];
    for (const path of this.allPaths) {
      const { state, error } = this.store.getChildLoadState(path);
      if (state !== 'loaded') {
        snapshot.push({
          path,
          state,
          error: error ?? null,
          expanded: this.store.isExpanded(path),
        });
      }
    }
    return snapshot;
  }

  /**
   * Restore half of the rebuild carry, applied to the FRESH store. `remap`
   * maps each old path to its new home (identity for setEntries) or null
   * for removed paths. Unmoved paths re-apply their exact state — including
   * `loading`, so an in-flight fetch stays valid across an unrelated
   * rebuild. Moved paths reset to `unloaded` and removed paths drop out;
   * both invalidate the old path's token, so the in-flight settlement is
   * discarded (the spec'd stale-response rule for moves/removals).
   */
  private restoreChildLoadStates(
    snapshot: readonly ChildLoadSnapshotEntry[],
    remap: (path: string) => string | null
  ): void {
    for (const entry of snapshot) {
      const target = remap(entry.path);
      if (target == null || !this.store.hasAccount(target)) {
        this.childLoadTokens.delete(entry.path);
        continue;
      }
      this.store.markUnloaded([target]);
      if (target !== entry.path) {
        this.childLoadTokens.delete(entry.path);
      } else if (entry.state === 'loading') {
        this.store.beginChildLoad(target);
      } else if (entry.state === 'error') {
        this.store.beginChildLoad(target);
        this.store.failChildLoad(target, entry.error ?? undefined);
      }
      this.store.setExpanded(target, entry.expanded);
    }
  }

  // --- Selection ---------------------------------------------------------------------

  /**
   * Selects a path with pointer-style modifier semantics: plain select
   * replaces the selection, `additive` (meta/ctrl) toggles the path, and
   * `range` (shift) selects the visible span between the anchor and the
   * path. A range with a hidden or missing anchor degrades to plain select.
   */
  selectPath(path: string, options: SelectPathOptions = {}): void {
    if (!this.store.hasAccount(path)) {
      return;
    }
    const { additive = false, range = false } = options;
    const before = this.snapshotSelection();

    const anchorIndex =
      this.selectionAnchor != null
        ? this.getPathIndex(this.selectionAnchor)
        : -1;
    const targetIndex = this.getPathIndex(path);

    if (range && anchorIndex >= 0 && targetIndex >= 0) {
      const visible = this.ensureVisibleCache();
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      if (!additive) {
        this.selection.clear();
      }
      for (let index = start; index <= end; index += 1) {
        // Placeholder rows are not selectable: a shift-range spanning a
        // loading group's spinner must not smuggle the marker into the set.
        if (!isChildLoadPlaceholderPath(visible[index])) {
          this.selection.add(visible[index]);
        }
      }
      // The anchor is intentionally preserved so successive shift-clicks
      // re-pivot around the same origin, like every desktop file tree.
    } else if (additive) {
      if (this.selection.has(path)) {
        this.selection.delete(path);
      } else {
        this.selection.add(path);
      }
      this.selectionAnchor = path;
    } else {
      this.selection.clear();
      this.selection.add(path);
      this.selectionAnchor = path;
    }

    const focusChanged = this.focusedPath !== path;
    this.focusedPath = path;
    this.emit({
      ...NO_CHANGE,
      selectionChanged: !this.selectionEquals(before),
      focusChanged,
    });
  }

  clearSelection(): void {
    if (this.selection.size === 0) {
      return;
    }
    this.selection.clear();
    this.selectionAnchor = null;
    this.emit({ ...NO_CHANGE, selectionChanged: true });
  }

  isSelected(path: string): boolean {
    return this.selection.has(path);
  }

  /** Selected paths in visible render order (hidden selections last). */
  getSelectedPaths(): string[] {
    const paths = [...this.selection];
    paths.sort((a, b) => {
      const indexA = this.getPathIndex(a);
      const indexB = this.getPathIndex(b);
      const orderA = indexA < 0 ? Number.MAX_SAFE_INTEGER : indexA;
      const orderB = indexB < 0 ? Number.MAX_SAFE_INTEGER : indexB;
      return orderA - orderB;
    });
    return paths;
  }

  // --- Focus ----------------------------------------------------------------------------

  getFocusedPath(): string | null {
    return this.focusedPath;
  }

  setFocusedPath(path: string | null): void {
    if (this.focusedPath === path) {
      return;
    }
    if (path != null && !this.store.hasAccount(path)) {
      return;
    }
    this.focusedPath = path;
    this.emit({ ...NO_CHANGE, focusChanged: true });
  }

  /**
   * Moves focus by `delta` rows over the visible projection (collapsed
   * subtrees are naturally skipped — they have no visible rows). With no
   * current focus, ArrowDown lands on the first row and ArrowUp on the last.
   * Child-load placeholder rows are not focus targets: focus continues past
   * them in the travel direction, staying put when only placeholders remain
   * that way. Returns the newly focused path, or null when the tree is empty.
   */
  moveFocus(delta: number): string | null {
    const visible = this.ensureVisibleCache();
    if (visible.length === 0) {
      return null;
    }
    const currentIndex =
      this.focusedPath != null ? this.getPathIndex(this.focusedPath) : -1;
    let nextIndex =
      currentIndex < 0
        ? delta >= 0
          ? 0
          : visible.length - 1
        : Math.max(0, Math.min(visible.length - 1, currentIndex + delta));
    const direction = delta >= 0 ? 1 : -1;
    while (
      nextIndex >= 0 &&
      nextIndex < visible.length &&
      isChildLoadPlaceholderPath(visible[nextIndex])
    ) {
      nextIndex += direction;
    }
    if (nextIndex < 0 || nextIndex >= visible.length) {
      return this.focusedPath; // Only placeholders that way: stay put.
    }
    this.setFocusedPath(visible[nextIndex]);
    return visible[nextIndex];
  }

  /** Focuses the visible row at `index` (clamped; placeholder rows resolve
   * to the nearest real row after, then before). Null when empty. */
  focusIndex(index: number): string | null {
    const visible = this.ensureVisibleCache();
    if (visible.length === 0) {
      return null;
    }
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    let target = clamped;
    while (
      target < visible.length &&
      isChildLoadPlaceholderPath(visible[target])
    ) {
      target += 1;
    }
    if (target >= visible.length) {
      target = clamped;
      while (target >= 0 && isChildLoadPlaceholderPath(visible[target])) {
        target -= 1;
      }
    }
    if (target < 0) {
      return null; // Degenerate: the projection holds only placeholders.
    }
    this.setFocusedPath(visible[target]);
    return visible[target];
  }

  /**
   * Type-ahead: focuses the next visible row (cyclically, starting after the
   * current focus) whose display name starts with the character,
   * case-insensitively. Returns the focused path or null when nothing
   * matches.
   */
  focusByTypeAhead(character: string): string | null {
    if (character.length !== 1) {
      return null;
    }
    const visible = this.ensureVisibleCache();
    if (visible.length === 0) {
      return null;
    }
    const needle = character.toLowerCase();
    const startIndex =
      this.focusedPath != null ? this.getPathIndex(this.focusedPath) : -1;
    for (let step = 1; step <= visible.length; step += 1) {
      const index = (startIndex + step) % visible.length;
      // Placeholder rows are never type-ahead targets (their marker string
      // would even leak the parent's leaf name into the match otherwise).
      if (isChildLoadPlaceholderPath(visible[index])) {
        continue;
      }
      const name = getAccountLeafName(visible[index]);
      if (name.length > 0 && name[0].toLowerCase() === needle) {
        this.setFocusedPath(visible[index]);
        return visible[index];
      }
    }
    return null;
  }

  // --- Search sessions ---------------------------------------------------------------------

  /**
   * Starts (or refines) a search session: case-insensitive substring match
   * of the query against each path segment. How matches reshape the tree is
   * the session's mode (see AccountTreeSearchMode); the expansion state from
   * before the session is snapshotted once and restored by `endSearch`. An
   * empty query matches nothing but keeps the session (and its snapshot)
   * alive — under the collapse/hide modes it also restores the snapshot
   * expansion, since "minimal expansion revealing no matches" would
   * otherwise collapse the whole tree mid-typing (backspace to empty).
   */
  beginSearch(
    query: string,
    options: BeginSearchOptions = {}
  ): AccountSearchResult {
    if (this.searchSession == null) {
      this.searchSession = {
        query,
        mode: options.mode ?? 'expand-matches',
        priorExpandedGroups: this.snapshotExpandedGroups(),
      };
    } else {
      // Refinement keeps the session's snapshot and (unless overridden) its
      // mode, so query edits and mode switches share one restore point.
      this.searchSession = {
        ...this.searchSession,
        query,
        mode: options.mode ?? this.searchSession.mode,
      };
    }
    const mode = this.searchSession.mode;

    const needle = query.toLowerCase();
    const matches: string[] = [];
    this.searchMatches.clear();
    if (needle !== '') {
      for (const path of this.allPaths) {
        if (pathSegmentsInclude(path, needle)) {
          matches.push(path);
          this.searchMatches.add(path);
        }
      }
    }

    // Distinct ancestors of all matches: the groups that must be expanded
    // for every match to own a visible row, and — with their matches — the
    // hide-non-matches projection filter. O(matches × depth).
    const expandedAncestors = new Set<string>();
    for (const match of matches) {
      for (const ancestor of getAncestorAccountPaths(match)) {
        expandedAncestors.add(ancestor);
      }
    }

    if (mode === 'expand-matches' || matches.length === 0) {
      // Original behavior: open ancestors, leave everything else alone. A
      // matchless query under the collapse/hide modes falls back here too,
      // restoring the snapshot instead of collapsing the world.
      if (matches.length === 0 && mode !== 'expand-matches') {
        this.restoreExpansionSnapshot();
      }
      for (const ancestor of expandedAncestors) {
        this.store.setExpanded(ancestor, true);
      }
    } else {
      // collapse-non-matches / hide-non-matches: the minimal expansion
      // revealing all matches is exactly the ancestor set — every other
      // group closes (hide additionally filters, but keeps the same minimal
      // expansion so ending the filter never reveals a half-open tree).
      for (const path of this.groupPaths) {
        this.store.setExpanded(path, expandedAncestors.has(path));
      }
    }

    // The hide filter allows matches and their ancestors only. Matches
    // hidden inside another match's collapsed subtree stay hidden — the
    // filter shapes which rows MAY appear; expansion still decides which do.
    this.searchVisibleFilter =
      mode === 'hide-non-matches' && matches.length > 0
        ? new Set([...this.searchMatches, ...expandedAncestors])
        : null;

    this.invalidateVisibleCache();
    // Every match is visible now that its ancestors are expanded, so tree
    // order is simply visible-index order.
    matches.sort((a, b) => this.getPathIndex(a) - this.getPathIndex(b));
    this.emit({ ...NO_CHANGE, expansionChanged: true, searchChanged: true });
    return { matches, expandedAncestors: [...expandedAncestors] };
  }

  /**
   * Ends the search session and restores the exact expansion state from
   * before `beginSearch` was first called. No-op when no session is active.
   */
  endSearch(): void {
    const session = this.searchSession;
    if (session == null) {
      return;
    }
    this.searchSession = null;
    this.searchMatches.clear();
    this.searchVisibleFilter = null;
    this.restoreExpansionSnapshot(session);
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true, searchChanged: true });
  }

  isSearchActive(): boolean {
    return this.searchSession != null;
  }

  getSearchQuery(): string | null {
    return this.searchSession?.query ?? null;
  }

  /** Mode of the active search session, or null when none is active. */
  getSearchMode(): AccountTreeSearchMode | null {
    return this.searchSession?.mode ?? null;
  }

  /**
   * Focuses the next search match after the focused row, cycling past the
   * end back to the first match. Deterministic order is projection (visible)
   * order. Returns the focused path, or null with no session / no matches.
   * (Pierre's trees clamp at the ends; we cycle so a single F3 keeps
   * walking a small match set — documented deviation.)
   */
  focusNextSearchMatch(): string | null {
    return this.focusRelativeSearchMatch(1);
  }

  /** Backward counterpart of `focusNextSearchMatch` (cyclic). */
  focusPreviousSearchMatch(): string | null {
    return this.focusRelativeSearchMatch(-1);
  }

  /**
   * `{ index, total }` readout for the active session (`3/12`-style UIs):
   * 1-based index of the focused match, or of the nearest upcoming match in
   * projection order when focus is not on a match (the row
   * `focusNextSearchMatch` would land on — Pierre's next-from-here
   * semantics), wrapping past the end. Null when no session is active;
   * `{ index: 0, total: 0 }` for a live session without matches.
   */
  getSearchMatchState(): AccountSearchMatchState | null {
    if (this.searchSession == null) {
      return null;
    }
    const matches = this.getOrderedSearchMatches();
    if (matches.length === 0) {
      return { index: 0, total: 0 };
    }
    return {
      index: this.findRelativeSearchMatch(matches, 0) + 1,
      total: matches.length,
    };
  }

  /** Restores the session's (or the given) expansion snapshot exactly. */
  private restoreExpansionSnapshot(
    session: SearchSession | null = this.searchSession
  ): void {
    if (session == null) {
      return;
    }
    const restore = new Set(session.priorExpandedGroups);
    for (const path of this.groupPaths) {
      this.store.setExpanded(path, restore.has(path));
    }
  }

  /**
   * Search matches in projection (visible) order. During a session every
   * match owns a visible row (ancestors are expanded in all modes; the hide
   * filter admits matches by construction), so filtering the visible paths
   * is both the order and the reveal guarantee in one O(visible) pass.
   */
  private getOrderedSearchMatches(): string[] {
    if (this.searchMatches.size === 0) {
      return [];
    }
    const ordered: string[] = [];
    for (const path of this.ensureVisibleCache()) {
      if (this.searchMatches.has(path)) {
        ordered.push(path);
      }
    }
    return ordered;
  }

  // Shared engine for match navigation and the match-state readout: the
  // match index `delta` steps away from the focused row. When focus already
  // sits on a match, steps are match-to-match (cyclic); otherwise the
  // anchor is the nearest match at/after the focused row (delta >= 0) or
  // before it (delta < 0), wrapping around the ends.
  private findRelativeSearchMatch(matches: string[], delta: number): number {
    const total = matches.length;
    const focused = this.focusedPath;
    if (focused != null && this.searchMatches.has(focused)) {
      const current = matches.indexOf(focused);
      if (current >= 0) {
        return (((current + delta) % total) + total) % total;
      }
    }
    const focusedIndex = focused != null ? this.getPathIndex(focused) : -1;
    if (delta >= 0) {
      for (let index = 0; index < total; index += 1) {
        if (this.getPathIndex(matches[index]) >= focusedIndex) {
          return index;
        }
      }
      return 0; // Focus sits past the last match: wrap to the first.
    }
    for (let index = total - 1; index >= 0; index -= 1) {
      const matchIndex = this.getPathIndex(matches[index]);
      if (matchIndex >= 0 && matchIndex < focusedIndex) {
        return index;
      }
    }
    return total - 1; // Focus sits before the first match: wrap to the last.
  }

  private focusRelativeSearchMatch(delta: -1 | 1): string | null {
    if (this.searchSession == null) {
      return null;
    }
    const matches = this.getOrderedSearchMatches();
    if (matches.length === 0) {
      return null;
    }
    // A focused non-match anchors AT the nearest upcoming match, so the
    // first "next" lands on it rather than skipping over it.
    const anchorsOnMatch =
      this.focusedPath != null && this.searchMatches.has(this.focusedPath);
    const step = anchorsOnMatch ? delta : delta > 0 ? 0 : -1;
    const target = matches[this.findRelativeSearchMatch(matches, step)];
    this.setFocusedPath(target);
    return target;
  }

  // --- Status decorations --------------------------------------------------------------------

  /**
   * Replaces all status decorations (git-status-style). Each entry decorates
   * one path with a colored dot and count; ancestors aggregate descendant
   * decorations (summed counts, highest severity) so collapsed groups still
   * signal what they contain.
   */
  setAccountStatus(entries: readonly AccountStatusEntry[]): void {
    this.ownStatus = new Map();
    for (const entry of entries) {
      if (!isValidAccountPath(entry.path)) {
        continue;
      }
      const count = entry.count ?? 1;
      const existing = this.ownStatus.get(entry.path);
      if (existing == null) {
        this.ownStatus.set(entry.path, { status: entry.status, count });
      } else {
        // Duplicate paths merge instead of last-write-wins: counts add up
        // and the more severe status wins, same as the ancestor roll-up.
        this.ownStatus.set(
          entry.path,
          mergeStatus(existing, entry.status, count)
        );
      }
    }
    this.rebuildStatusRollup();
    this.emit({ ...NO_CHANGE, statusChanged: true });
  }

  /** Own (non-rolled) status decoration for a path, or null. */
  getOwnStatus(path: string): StatusAggregate | null {
    return this.ownStatus.get(path) ?? null;
  }

  /** Rolled-up status decoration (own + descendants) for a path, or null. */
  getRolledStatus(path: string): StatusAggregate | null {
    return this.rolledStatus.get(path) ?? null;
  }

  // --- Rename ------------------------------------------------------------------------------------

  /** Path currently in an inline rename session, or null. */
  getRenamingPath(): string | null {
    return this.renamingPath;
  }

  /** Current rename draft text (survives virtualization-window eviction). */
  getRenameDraft(): string {
    return this.renameDraft;
  }

  /**
   * Updates the rename draft as the user types. Deliberately does not emit a
   * change event — the DOM input already shows the text; the draft only
   * needs to be re-read when the row re-renders.
   */
  setRenameDraft(value: string): void {
    if (this.renamingPath != null) {
      this.renameDraft = value;
    }
  }

  /**
   * Starts an inline rename session for a path. The draft seeds from the
   * leaf name. Returns false for unknown paths.
   */
  beginRename(path: string): boolean {
    if (!this.store.hasAccount(path) || this.renamingPath === path) {
      return this.renamingPath === path;
    }
    this.renamingPath = path;
    this.renameDraft = getAccountLeafName(path);
    this.emit({ ...NO_CHANGE, renameChanged: true });
    return true;
  }

  /** Ends the rename session without applying anything. */
  cancelRename(): void {
    if (this.renamingPath == null) {
      return;
    }
    this.renamingPath = null;
    this.renameDraft = '';
    this.emit({ ...NO_CHANGE, renameChanged: true });
  }

  /**
   * Validates and applies a leaf rename: `Assets:Current` renamed to `Ops`
   * becomes `Assets:Ops`, and every descendant, the expansion set, the
   * selection, focus, and status decorations follow the remap. The store is
   * entry/path-derived, so the remap rebuilds it from remapped inputs (a
   * medium-workload rebuild measures ~4ms — see scripts/benchmark.ts).
   * Fires `onRename(oldPath, newPath)` on success. On failure the rename
   * session (if any) stays open so the view can decide to retry or cancel.
   */
  commitRename(path: string, newLeafName: string): RenameResult {
    if (!this.store.hasAccount(path)) {
      return { ok: false, reason: 'unknown-path' };
    }
    const leaf = newLeafName.trim();
    if (leaf === '' || leaf.includes(':')) {
      return { ok: false, reason: 'invalid-name' };
    }
    const parent = getParentAccountPath(path);
    const newPath = parent == null ? leaf : `${parent}:${leaf}`;
    if (!isValidAccountPath(newPath)) {
      return { ok: false, reason: 'invalid-name' };
    }
    if (newPath === path) {
      // Committing the unchanged name is a successful no-op: end the session
      // without firing onRename or rebuilding anything.
      if (this.renamingPath === path) {
        this.renamingPath = null;
        this.renameDraft = '';
        this.emit({ ...NO_CHANGE, renameChanged: true });
      }
      return { ok: true, newPath };
    }
    if (this.store.hasAccount(newPath)) {
      return { ok: false, reason: 'collision' };
    }

    const renameEndsSession = this.renamingPath === path;
    if (renameEndsSession) {
      this.renamingPath = null;
      this.renameDraft = '';
    }
    this.applyRemap([{ from: path, to: newPath }], {
      renameChanged: renameEndsSession,
    });
    for (const listener of this.renameListeners) {
      listener(path, newPath);
    }
    return { ok: true, newPath };
  }

  /** Registers a rename listener; returns an unsubscribe function. */
  onRename(listener: AccountRenameListener): () => void {
    this.renameListeners.add(listener);
    return () => {
      this.renameListeners.delete(listener);
    };
  }

  // --- Drag & drop moves ---------------------------------------------------------------------------

  /**
   * Computes the moves a drop would perform under the SKIP collision
   * strategy (the original behavior — colliding candidates drop out, the
   * rest survive), applying the Pierre guard set without mutating anything.
   * Kept as the back-compat surface; strategy-aware callers use
   * `planMovePaths` for the full moves/skipped/replaced breakdown.
   */
  getMovePlan(
    sourcePaths: readonly string[],
    targetGroupPath: string
  ): AccountMove[] {
    return this.planMovePaths(sourcePaths, targetGroupPath, 'skip').moves;
  }

  /**
   * Strategy-aware move planning: the full breakdown a drop would apply,
   * without mutating anything. Sources are normalized first (duplicates and
   * descendants of other sources dropped, so each subtree moves once); then
   * per source: unknown paths, self-drops, drops into the source's own
   * subtree, and drops onto the current parent (no-op) are guarded away
   * silently, exactly as before. Leaf-name collisions at the target are the
   * strategy's territory:
   *
   * - `reject`: any collision empties `moves` and pushes EVERY candidate
   *   (clean and colliding) into `skipped`, so callers can report the whole
   *   attempted batch.
   * - `skip`: colliding candidates land in `skipped`; the rest proceed.
   * - `replace`: the existing account at the destination joins `replaced`
   *   (its subtree will be removed) and the move proceeds.
   *
   * Within-batch collisions (two dragged subtrees sharing a leaf name) keep
   * first-claim-wins under every strategy — `replace` cannot remove a
   * subtree that only exists once the batch applies. A source that sits
   * inside a subtree already claimed for replacement is skipped too: it
   * will not exist once the replacement applies. Returns an empty plan when
   * the target is not an existing group.
   */
  planMovePaths(
    sourcePaths: readonly string[],
    targetGroupPath: string,
    collision: AccountDropCollision = 'reject'
  ): AccountMovePlan {
    const plan: AccountMovePlan = { moves: [], skipped: [], replaced: [] };
    if (!this.groupPaths.has(targetGroupPath)) {
      return plan;
    }
    const claimedDestinations = new Set<string>();
    for (const source of normalizeMoveSources(sourcePaths)) {
      if (!this.store.hasAccount(source)) {
        continue;
      }
      if (
        targetGroupPath === source ||
        targetGroupPath.startsWith(`${source}:`)
      ) {
        continue; // Self or own-descendant drop.
      }
      if (getParentAccountPath(source) === targetGroupPath) {
        continue; // Already a child of the target: no-op.
      }
      const destination = `${targetGroupPath}:${getAccountLeafName(source)}`;
      if (
        plan.replaced.some(
          (removed) => source === removed || source.startsWith(`${removed}:`)
        )
      ) {
        // The source lives inside a subtree an earlier candidate replaces.
        plan.skipped.push({ from: source, to: destination });
        continue;
      }
      if (claimedDestinations.has(destination)) {
        // Within-batch collision: first claim wins under every strategy.
        plan.skipped.push({ from: source, to: destination });
        continue;
      }
      if (this.store.hasAccount(destination)) {
        if (collision === 'replace') {
          plan.replaced.push(destination);
        } else {
          plan.skipped.push({ from: source, to: destination });
          continue;
        }
      }
      claimedDestinations.add(destination);
      plan.moves.push({ from: source, to: destination });
    }
    if (collision === 'reject' && plan.skipped.length > 0) {
      // Any collision blocks the WHOLE drop; skipped becomes the full
      // attempted batch (applied-order first, then the colliding ones).
      plan.skipped = [...plan.moves, ...plan.skipped];
      plan.moves = [];
    }
    return plan;
  }

  /**
   * Applies a plan produced by `planMovePaths`: replaced subtrees are
   * removed and the moves re-parented through the SAME remap rebuild —
   * expansion, selection, focus, status, and search sessions carry across,
   * and exactly ONE change event fires for the whole operation. Fires
   * `onMove` with the applied moves (before any view-level drop callbacks —
   * see AccountTree's ordering contract). No-op for an empty plan. Returns
   * the plan for fluent use by callers that report the breakdown.
   */
  applyMovePlan(plan: AccountMovePlan): AccountMovePlan {
    if (plan.moves.length === 0) {
      return plan;
    }
    this.applyRemap(plan.moves, {}, plan.replaced);
    for (const listener of this.moveListeners) {
      listener(plan.moves);
    }
    return plan;
  }

  /**
   * Re-parents the sources under a target group using the same remap
   * machinery as rename (subtrees move whole; balances re-roll under the new
   * ancestors). Invalid sources are skipped per `getMovePlan` (SKIP
   * collision semantics — the original behavior of this method); fires
   * `onMove` with the applied moves and returns them ([] when nothing
   * applied). Strategy-aware callers compose `planMovePaths` +
   * `applyMovePlan` instead.
   */
  movePaths(
    sourcePaths: readonly string[],
    targetGroupPath: string
  ): AccountMove[] {
    return this.applyMovePlan(
      this.planMovePaths(sourcePaths, targetGroupPath, 'skip')
    ).moves;
  }

  /** Registers a move listener; returns an unsubscribe function. */
  onMove(listener: AccountMoveListener): () => void {
    this.moveListeners.add(listener);
    return () => {
      this.moveListeners.delete(listener);
    };
  }

  // --- Events -----------------------------------------------------------------------------------

  /** Registers a change listener; returns an unsubscribe function. */
  onChange(listener: AccountTreeChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Internals ----------------------------------------------------------------------------------

  /**
   * Builds a fresh engine store and re-derives the controller's own path
   * indexes (all paths incl. ancestors, and which paths are groups) from the
   * same inputs — the store does not expose a path enumeration API.
   */
  private buildStore(
    entries: readonly LedgerEntry[],
    accounts: readonly string[]
  ): AccountStore {
    const all = new Set<string>();
    const collect = (path: string): void => {
      if (!isValidAccountPath(path) || all.has(path)) {
        return;
      }
      all.add(path);
      for (const ancestor of getAncestorAccountPaths(path)) {
        all.add(ancestor);
      }
    };
    for (const entry of entries) {
      for (const posting of entry.postings) {
        collect(posting.account);
      }
    }
    for (const path of accounts) {
      collect(path);
    }

    this.groupPaths = new Set();
    this.childrenByParent = new Map();
    for (const path of all) {
      const parent = getParentAccountPath(path) ?? '';
      if (parent !== '') {
        this.groupPaths.add(parent);
      }
      const siblings = this.childrenByParent.get(parent);
      if (siblings == null) {
        this.childrenByParent.set(parent, [path]);
      } else {
        siblings.push(path);
      }
    }
    // Sibling order must match the store's (plain code-point order on leaf
    // names) so projection indexes agree with store slices.
    for (const siblings of this.childrenByParent.values()) {
      siblings.sort((a, b) => {
        const leafA = getAccountLeafName(a);
        const leafB = getAccountLeafName(b);
        return leafA < leafB ? -1 : leafA > leafB ? 1 : 0;
      });
    }
    this.allPaths = [...all];
    this.invalidateVisibleCache();
    return new AccountStore({ entries, accountPaths: accounts });
  }

  /**
   * The shared remap engine behind rename and drag & drop. The store's
   * topology is immutable and entry/path-derived, so a path remap means:
   * rewrite every posting account and explicit account path through the move
   * list, rebuild the store (single-digit milliseconds on the medium
   * workload — balances re-roll under the new ancestors for free), then
   * carry expansion, selection, focus, status decorations, and any search
   * session across by remapping their paths too. Emits one honest change
   * event for the whole operation.
   *
   * `removedPaths` (the `dropCollision: 'replace'` half) removes whole
   * subtrees FIRST, inside the same rebuild: the controller's inputs are
   * entries + explicit accounts, so removal means filtering both before the
   * remap runs — ledger entries with any posting inside a removed subtree
   * are dropped whole (a partial entry would not balance), and explicit
   * account paths under a removed prefix vanish. Selection, focus, anchor,
   * rename session, status decorations, and search matches on removed paths
   * are dropped the same way `setEntries` drops vanished paths. Removal
   * filters test ORIGINAL paths (pre-remap) — the moves that motivated the
   * removal land ON the removed destinations afterwards.
   */
  private applyRemap(
    moves: readonly AccountMove[],
    extra: Partial<AccountTreeChange>,
    removedPaths: readonly string[] = []
  ): void {
    if (moves.length === 0) {
      return;
    }
    const remap = (path: string): string => remapPathThrough(moves, path);
    const isRemoved = (path: string): boolean =>
      removedPaths.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}:`)
      );

    // Snapshot collapsed groups before the rebuild (the fresh store defaults
    // to fully expanded), remapped onto their new paths. Removed groups have
    // no new path to carry state to.
    const collapsedGroups: string[] = [];
    for (const path of this.groupPaths) {
      if (!this.store.isExpanded(path) && !isRemoved(path)) {
        collapsedGroups.push(remap(path));
      }
    }
    // Child-load states carry across the rebuild the same way (see
    // restoreChildLoadStates for the moved/removed staleness rules).
    const childLoadSnapshot = this.snapshotChildLoadStates();

    this.entries = this.entries
      .filter(
        (entry) => !entry.postings.some((posting) => isRemoved(posting.account))
      )
      .map((entry) => remapEntry(entry, moves));
    this.accounts = this.accounts.filter((path) => !isRemoved(path)).map(remap);

    let selectionChanged = false;
    const remappedSelection: string[] = [];
    for (const path of this.selection) {
      if (isRemoved(path)) {
        selectionChanged = true;
        continue;
      }
      const next = remap(path);
      if (next !== path) {
        selectionChanged = true;
      }
      remappedSelection.push(next);
    }
    this.selection.clear();
    for (const path of remappedSelection) {
      this.selection.add(path);
    }
    if (this.selectionAnchor != null) {
      this.selectionAnchor = isRemoved(this.selectionAnchor)
        ? null
        : remap(this.selectionAnchor);
    }
    let focusChanged = false;
    if (this.focusedPath != null) {
      const next = isRemoved(this.focusedPath) ? null : remap(this.focusedPath);
      focusChanged = next !== this.focusedPath;
      this.focusedPath = next;
    }
    let renameEnded = false;
    if (this.renamingPath != null) {
      if (isRemoved(this.renamingPath)) {
        // The renamed account was replaced away mid-session: end the session
        // instead of leaving an editor open on a vanished path.
        this.renamingPath = null;
        this.renameDraft = '';
        renameEnded = true;
      } else {
        this.renamingPath = remap(this.renamingPath);
      }
    }

    // Status decorations follow their accounts; distinct old paths can only
    // collide onto one new path through pathological move lists, but merge
    // instead of dropping data if they ever do.
    let statusDropped = false;
    const remappedStatus = new Map<string, StatusAggregate>();
    for (const [path, aggregate] of this.ownStatus) {
      if (isRemoved(path)) {
        statusDropped = true;
        continue;
      }
      const next = remap(path);
      const existing = remappedStatus.get(next);
      remappedStatus.set(
        next,
        existing == null
          ? aggregate
          : mergeStatus(existing, aggregate.status, aggregate.count)
      );
    }
    this.ownStatus = remappedStatus;

    if (this.searchSession != null) {
      this.searchSession = {
        query: this.searchSession.query,
        mode: this.searchSession.mode,
        priorExpandedGroups: this.searchSession.priorExpandedGroups
          .filter((path) => !isRemoved(path))
          .map(remap),
      };
      const remappedMatches = new Set<string>();
      for (const match of this.searchMatches) {
        if (!isRemoved(match)) {
          remappedMatches.add(remap(match));
        }
      }
      this.searchMatches = remappedMatches;
      if (this.searchVisibleFilter != null) {
        // Rebuild (not just remap) the hide filter: a moved match sits
        // under new ancestors, which must join the allowed set for the
        // match to keep its visible row.
        const filter = new Set<string>();
        for (const match of this.searchMatches) {
          filter.add(match);
          for (const ancestor of getAncestorAccountPaths(match)) {
            filter.add(ancestor);
          }
        }
        this.searchVisibleFilter = filter;
      }
    }

    this.store = this.buildStore(this.entries, this.accounts);
    for (const path of collapsedGroups) {
      this.store.setExpanded(path, false);
    }
    this.restoreChildLoadStates(childLoadSnapshot, (path) =>
      isRemoved(path) ? null : remap(path)
    );
    this.rebuildStatusRollup();
    this.invalidateVisibleCache();
    this.emit({
      ...NO_CHANGE,
      expansionChanged: true,
      statusChanged: this.ownStatus.size > 0 || statusDropped,
      selectionChanged,
      focusChanged,
      renameChanged: renameEnded,
      // Remaps rewrite match/session paths, so search consumers (match
      // decorations, {index,total} readouts) must re-read.
      searchChanged: this.searchSession != null,
      ...extra,
    });
  }

  /** Applies the constructor's initialExpansion mode onto a fresh store. */
  private applyInitialExpansion(
    mode: AccountTreeControllerOptions['initialExpansion']
  ): void {
    if (mode == null || mode === 'all') {
      return; // The store default is fully expanded.
    }
    this.store.collapseAll();
    if (mode === 'top-level') {
      for (const path of this.groupPaths) {
        if (getParentAccountPath(path) == null) {
          this.store.setExpanded(path, true);
        }
      }
    } else {
      // Explicit list: expand the listed groups plus their ancestors so the
      // listed groups are actually reachable in the projection.
      for (const path of mode) {
        this.store.setExpanded(path, true);
        for (const ancestor of getAncestorAccountPaths(path)) {
          this.store.setExpanded(ancestor, true);
        }
      }
    }
    this.invalidateVisibleCache();
  }

  /** Group paths currently expanded (search-session snapshot source). */
  private snapshotExpandedGroups(): string[] {
    const expanded: string[] = [];
    for (const path of this.groupPaths) {
      if (this.store.isExpanded(path)) {
        expanded.push(path);
      }
    }
    return expanded;
  }

  /**
   * Recomputes ancestor status aggregates from the own decorations: counts
   * sum and the highest severity wins. O(entries × depth) — decoration sets
   * are small (unreconciled/flagged items), never the whole chart.
   */
  private rebuildStatusRollup(): void {
    this.rolledStatus = new Map();
    for (const [path, aggregate] of this.ownStatus) {
      if (!this.store.hasAccount(path)) {
        continue;
      }
      const targets = [path, ...getAncestorAccountPaths(path)];
      for (const target of targets) {
        const existing = this.rolledStatus.get(target);
        this.rolledStatus.set(
          target,
          existing == null
            ? { status: aggregate.status, count: aggregate.count }
            : mergeStatus(existing, aggregate.status, aggregate.count)
        );
      }
    }
  }

  /**
   * Effective decoration for a row: its own status always shows; a
   * collapsed group without own status inherits the roll-up so hidden
   * problems stay visible (git-status propagation).
   */
  private getEffectiveStatus(
    path: string,
    isGroup: boolean,
    expanded: boolean
  ): StatusAggregate | null {
    const own = this.ownStatus.get(path);
    if (own != null) {
      return own;
    }
    if (isGroup && !expanded) {
      return this.rolledStatus.get(path) ?? null;
    }
    return null;
  }

  /**
   * Rebuilds the flatten-aware visible projection when dirty: a preorder DFS
   * over the controller's child table that only descends into expanded
   * groups. With flattening on, a group whose only child is another group
   * merges into one row keyed by the chain's deepest group; intermediate
   * expansion states are deliberately ignored (the chain acts as one node,
   * toggled via its deepest path), which is exactly what makes the feature
   * projection-level: turning it off restores the store-truth tree.
   *
   * With a `hide-non-matches` search filter active, siblings outside the
   * precomputed match/ancestor set are dropped before frames are pushed.
   * Anything outside that set has no match anywhere in its subtree (an
   * ancestor of a match is in the set by construction), so skipping the
   * node skips its whole subtree with a single O(1) set lookup — the walk
   * stays O(visible + filtered siblings), never a per-row subtree scan.
   * posInSet/setSize are assigned from the FILTERED sibling list: the
   * canonical sibling counts describe the unfiltered tree and would lie to
   * assistive tech about rows that are not in the projection at all.
   */
  private ensureProjection(): ProjectionRow[] {
    if (this.projectionCache != null) {
      return this.projectionCache;
    }
    const projection: ProjectionRow[] = [];
    const paths: string[] = [];
    this.visibleIndexByPath = new Map();
    const filter = this.searchVisibleFilter;

    interface Frame {
      path: string;
      depth: number;
      posInSet: number;
      setSize: number;
      /** Set on synthetic child-load placeholder frames (see below). */
      placeholder?: AccountChildLoadPlaceholder;
    }
    const stack: Frame[] = [];
    const pushChildren = (children: readonly string[], depth: number): void => {
      const admitted =
        filter == null
          ? children
          : children.filter((child) => filter.has(child));
      for (let index = admitted.length - 1; index >= 0; index -= 1) {
        stack.push({
          path: admitted[index],
          depth,
          posInSet: index + 1,
          setSize: admitted.length,
        });
      }
    };
    pushChildren(this.childrenByParent.get('') ?? [], 0);

    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame == null) {
        break;
      }
      // Synthetic child-load placeholder rows (loading dots / error+Retry):
      // one fixed-height projection row under the pending group, so all the
      // `index * rowHeight` windowing math holds without special cases. The
      // marker path joins the paths cache (indexes must stay aligned) but
      // never the path→index map — it names no account.
      if (frame.placeholder != null) {
        projection.push({
          path: frame.path,
          name: '',
          depth: frame.depth,
          kind: 'leaf',
          posInSet: frame.posInSet,
          setSize: frame.setSize,
          flattenedNames: null,
          loadPlaceholder: frame.placeholder,
        });
        paths.push(frame.path);
        continue;
      }
      // Flatten single-child group chains: follow the chain while the
      // current group has exactly one child and that child is a group. The
      // hide filter gates each hop — a match with no matching descendants
      // must stay the chain's terminal row, not merge into hidden children.
      // Chains never start from or run through a group with a pending child
      // load: its descendant set is unknown (or mid-fetch), so merging it
      // into a chain would hide the very row the placeholder attaches to.
      let rowPath = frame.path;
      let flattenedNames: string[] | null = null;
      if (this.flattenEmptyGroups) {
        let chainNames: string[] | null = null;
        while (
          this.groupPaths.has(rowPath) &&
          this.store.getChildLoadState(rowPath).state === 'loaded'
        ) {
          const children = this.childrenByParent.get(rowPath);
          if (
            children == null ||
            children.length !== 1 ||
            !this.groupPaths.has(children[0]) ||
            this.store.getChildLoadState(children[0]).state !== 'loaded' ||
            (filter != null && !filter.has(children[0]))
          ) {
            break;
          }
          chainNames ??= [getAccountLeafName(frame.path)];
          rowPath = children[0];
          chainNames.push(getAccountLeafName(rowPath));
        }
        flattenedNames = chainNames;
      }

      // Pending child-load paths are groups even with zero known children —
      // the projection-honesty rule, mirrored from the store's group-ness.
      const loadState = this.store.getChildLoadState(rowPath).state;
      const isGroup = this.groupPaths.has(rowPath) || loadState !== 'loaded';
      const rowIndex = projection.length;
      projection.push({
        path: rowPath,
        name: getAccountLeafName(rowPath),
        depth: frame.depth,
        kind: isGroup ? 'group' : 'leaf',
        posInSet: frame.posInSet,
        setSize: frame.setSize,
        flattenedNames,
      });
      paths.push(rowPath);
      this.visibleIndexByPath.set(rowPath, rowIndex);

      if (isGroup && this.store.isExpanded(rowPath)) {
        pushChildren(this.childrenByParent.get(rowPath) ?? [], frame.depth + 1);
        // The placeholder frame is pushed LAST so it pops FIRST — the
        // loading/error row renders as the group's first child, ahead of
        // any children the store already knows.
        if (loadState === 'loading' || loadState === 'error') {
          const load = this.store.getChildLoadState(rowPath);
          stack.push({
            path: makeChildLoadPlaceholderPath(rowPath),
            depth: frame.depth + 1,
            posInSet: 0,
            setSize: 0,
            placeholder: {
              parentPath: rowPath,
              state: loadState,
              error: load.error ?? null,
            },
          });
        }
      }
    }

    this.projectionCache = projection;
    this.visiblePathsCache = paths;
    return projection;
  }

  /** Visible paths in render order (projection-backed). */
  private ensureVisibleCache(): string[] {
    this.ensureProjection();
    return this.visiblePathsCache ?? [];
  }

  private invalidateVisibleCache(): void {
    this.projectionCache = null;
    this.visiblePathsCache = null;
    this.visibleIndexByPath = new Map();
  }

  private snapshotSelection(): Set<string> {
    return new Set(this.selection);
  }

  private selectionEquals(other: ReadonlySet<string>): boolean {
    if (other.size !== this.selection.size) {
      return false;
    }
    for (const path of other) {
      if (!this.selection.has(path)) {
        return false;
      }
    }
    return true;
  }

  private emit(change: AccountTreeChange): void {
    if (
      !change.expansionChanged &&
      !change.selectionChanged &&
      !change.statusChanged &&
      !change.focusChanged &&
      !change.renameChanged &&
      !change.searchChanged
    ) {
      return;
    }
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}

// Case-insensitive substring match of `needle` (already lowercased) against
// each colon-delimited segment of the path.
function pathSegmentsInclude(path: string, needle: string): boolean {
  let segmentStart = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index === path.length || path[index] === ':') {
      const segment = path.slice(segmentStart, index).toLowerCase();
      if (segment.includes(needle)) {
        return true;
      }
      segmentStart = index + 1;
    }
  }
  return false;
}

// Merges a status contribution into an aggregate: counts add, severity wins.
function mergeStatus(
  existing: StatusAggregate,
  status: AccountStatusKind,
  count: number
): StatusAggregate {
  return {
    status:
      STATUS_SEVERITY[status] > STATUS_SEVERITY[existing.status]
        ? status
        : existing.status,
    count: existing.count + count,
  };
}

// Rewrites one path through a move list: an exact match maps to the move's
// destination, a descendant keeps its suffix under the new prefix. Move
// sources are disjoint (getMovePlan normalizes ancestors/descendants away),
// so first match wins and one pass suffices.
function remapPathThrough(moves: readonly AccountMove[], path: string): string {
  for (const move of moves) {
    if (path === move.from) {
      return move.to;
    }
    if (path.startsWith(`${move.from}:`)) {
      return move.to + path.slice(move.from.length);
    }
  }
  return path;
}

// Rewrites an entry's posting accounts through the move list, preserving
// object identity when nothing changed so untouched entries never re-render.
function remapEntry(
  entry: LedgerEntry,
  moves: readonly AccountMove[]
): LedgerEntry {
  let changed = false;
  const postings: Posting[] = entry.postings.map((posting) => {
    const account = remapPathThrough(moves, posting.account);
    if (account === posting.account) {
      return posting;
    }
    changed = true;
    return { ...posting, account };
  });
  return changed ? { ...entry, postings } : entry;
}

// Multi-select drags move each subtree once: duplicates and paths whose
// ancestor is also being dragged are removed (the ancestor's move carries
// them). Selections are small, so the ancestor scan per path is fine.
function normalizeMoveSources(paths: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      unique.push(path);
    }
  }
  return unique.filter(
    (path) =>
      !unique.some((other) => other !== path && path.startsWith(`${other}:`))
  );
}
