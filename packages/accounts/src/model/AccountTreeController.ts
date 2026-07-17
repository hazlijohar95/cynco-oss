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
  AccountSearchResult,
  AccountStatusEntry,
  AccountStatusKind,
  AccountTreeChange,
  AccountTreeChangeListener,
  AccountTreeControllerOptions,
  AccountTreeDensity,
  AccountTreeRowData,
  LedgerEntry,
  RowRange,
  SelectPathOptions,
} from '../types';

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
  /** Group paths that were expanded when the session began. */
  priorExpandedGroups: readonly string[];
}

const NO_CHANGE: AccountTreeChange = {
  expansionChanged: false,
  selectionChanged: false,
  statusChanged: false,
  focusChanged: false,
};

export class AccountTreeController {
  private store: AccountStore;
  /** Every canonical account path in the store, implied ancestors included. */
  private allPaths: string[] = [];
  /** Paths that have at least one child (expandable groups). */
  private groupPaths: Set<string> = new Set();

  private density: AccountTreeDensity;
  private readonly currency: string;
  private readonly showBalances: boolean;
  private accounts: readonly string[];

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
   * Visible paths in render order plus a reverse index, rebuilt lazily after
   * expansion changes. Keyboard navigation, range selection, and sticky
   * ancestor lookup all need path→index mapping; caching it means one O(n)
   * rebuild per expansion change instead of one scan per keystroke.
   */
  private visiblePathsCache: string[] | null = null;
  private visibleIndexByPath = new Map<string, number>();

  private readonly listeners = new Set<AccountTreeChangeListener>();

  constructor(options: AccountTreeControllerOptions = {}) {
    const {
      entries = [],
      accounts = [],
      initialExpansion = 'all',
      density = 'default',
      currency = DEFAULT_CURRENCY,
      showBalances = true,
    } = options;
    this.density = density;
    this.currency = currency;
    this.showBalances = showBalances;
    this.accounts = accounts;
    this.store = this.buildStore(entries, accounts);
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

    this.store = this.buildStore(entries, this.accounts);
    for (const path of collapsedGroups) {
      this.store.setExpanded(path, false);
    }

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
    return this.store.getVisibleCount();
  }

  /**
   * Materializes decoration-complete rows for the half-open `[start, end)`
   * range: the store's per-row data plus selection, focus, search-match, and
   * effective status, with the rolled balance extracted in the primary
   * display currency. Slices are viewport-sized, so allocation stays bounded.
   */
  getRows(start: number, end: number): AccountTreeRowData[] {
    const rows = this.store.getVisibleSlice(start, end);
    const decorated: AccountTreeRowData[] = [];
    for (const row of rows) {
      const status = this.getEffectiveStatus(
        row.path,
        row.kind === 'group',
        row.expanded
      );
      decorated.push({
        path: row.path,
        name: row.name,
        depth: row.depth,
        kind: row.kind,
        expanded: row.expanded,
        setSize: row.setSize,
        posInSet: row.posInSet,
        balance: this.showBalances
          ? (row.rolledBalances.get(this.currency) ?? null)
          : null,
        selected: this.selection.has(row.path),
        focused: this.focusedPath === row.path,
        searchMatch: this.searchMatches.has(row.path),
        status: status?.status ?? null,
        statusCount: status?.count ?? 0,
      });
    }
    return decorated;
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

  /** Visible paths in render order (cached; do not mutate). */
  getVisiblePaths(): readonly string[] {
    return this.ensureVisibleCache();
  }

  /** Index of a path in the visible projection, or -1 when hidden/unknown. */
  getPathIndex(path: string): number {
    this.ensureVisibleCache();
    return this.visibleIndexByPath.get(path) ?? -1;
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
  }

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
        this.selection.add(visible[index]);
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
   * Returns the newly focused path, or null when the tree is empty.
   */
  moveFocus(delta: number): string | null {
    const visible = this.ensureVisibleCache();
    if (visible.length === 0) {
      return null;
    }
    const currentIndex =
      this.focusedPath != null ? this.getPathIndex(this.focusedPath) : -1;
    const nextIndex =
      currentIndex < 0
        ? delta >= 0
          ? 0
          : visible.length - 1
        : Math.max(0, Math.min(visible.length - 1, currentIndex + delta));
    this.setFocusedPath(visible[nextIndex]);
    return visible[nextIndex];
  }

  /** Focuses the visible row at `index` (clamped). Null when empty. */
  focusIndex(index: number): string | null {
    const visible = this.ensureVisibleCache();
    if (visible.length === 0) {
      return null;
    }
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    this.setFocusedPath(visible[clamped]);
    return visible[clamped];
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
   * of the query against each path segment. Ancestors of every match are
   * auto-expanded so matches are visible; the expansion state from before
   * the session is snapshotted once and restored by `endSearch`. An empty
   * query matches nothing but keeps the session (and its snapshot) alive.
   */
  beginSearch(query: string): AccountSearchResult {
    if (this.searchSession == null) {
      this.searchSession = {
        query,
        priorExpandedGroups: this.snapshotExpandedGroups(),
      };
    } else {
      this.searchSession = { ...this.searchSession, query };
    }

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

    const expandedAncestors = new Set<string>();
    for (const match of matches) {
      for (const ancestor of getAncestorAccountPaths(match)) {
        if (!expandedAncestors.has(ancestor)) {
          expandedAncestors.add(ancestor);
          this.store.setExpanded(ancestor, true);
        }
      }
    }

    this.invalidateVisibleCache();
    // Every match is visible now that its ancestors are expanded, so tree
    // order is simply visible-index order.
    matches.sort((a, b) => this.getPathIndex(a) - this.getPathIndex(b));
    this.emit({ ...NO_CHANGE, expansionChanged: true });
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
    const restore = new Set(session.priorExpandedGroups);
    for (const path of this.groupPaths) {
      this.store.setExpanded(path, restore.has(path));
    }
    this.invalidateVisibleCache();
    this.emit({ ...NO_CHANGE, expansionChanged: true });
  }

  isSearchActive(): boolean {
    return this.searchSession != null;
  }

  getSearchQuery(): string | null {
    return this.searchSession?.query ?? null;
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
    for (const path of all) {
      const parent = getParentAccountPath(path);
      if (parent != null) {
        this.groupPaths.add(parent);
      }
    }
    this.allPaths = [...all];
    this.invalidateVisibleCache();
    return new AccountStore({ entries, accountPaths: accounts });
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

  private ensureVisibleCache(): string[] {
    if (this.visiblePathsCache != null) {
      return this.visiblePathsCache;
    }
    const rows = this.store.getVisibleSlice(0, this.store.getVisibleCount());
    const paths: string[] = new Array(rows.length);
    this.visibleIndexByPath = new Map();
    for (let index = 0; index < rows.length; index += 1) {
      paths[index] = rows[index].path;
      this.visibleIndexByPath.set(rows[index].path, index);
    }
    this.visiblePathsCache = paths;
    return paths;
  }

  private invalidateVisibleCache(): void {
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
      !change.focusChanged
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
