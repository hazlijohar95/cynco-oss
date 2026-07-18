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
  AccountMove,
  AccountMoveListener,
  AccountRenameListener,
  AccountSearchResult,
  AccountStatusEntry,
  AccountStatusKind,
  AccountTreeChange,
  AccountTreeChangeListener,
  AccountTreeControllerOptions,
  AccountTreeDensity,
  AccountTreeRowData,
  LedgerEntry,
  Posting,
  RenameResult,
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
  renameChanged: false,
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
    } = options;
    this.density = density;
    this.currency = currency;
    this.showBalances = showBalances;
    this.flattenEmptyGroups = flattenEmptyGroups;
    this.accounts = accounts;
    this.entries = entries;
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

    this.entries = entries;
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
   * Computes the moves a drop would perform, applying the Pierre guard set
   * without mutating anything. Sources are normalized first (duplicates and
   * descendants of other sources dropped, so each subtree moves once); then
   * per source: unknown paths, self-drops, drops into the source's own
   * subtree, drops onto the current parent (no-op), and leaf-name collisions
   * at the target are all skipped. Returns [] when the target is not an
   * existing group.
   */
  getMovePlan(
    sourcePaths: readonly string[],
    targetGroupPath: string
  ): AccountMove[] {
    if (!this.groupPaths.has(targetGroupPath)) {
      return [];
    }
    const moves: AccountMove[] = [];
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
        this.store.hasAccount(destination) ||
        claimedDestinations.has(destination)
      ) {
        continue; // Leaf-name collision at the target.
      }
      claimedDestinations.add(destination);
      moves.push({ from: source, to: destination });
    }
    return moves;
  }

  /**
   * Re-parents the sources under a target group using the same remap
   * machinery as rename (subtrees move whole; balances re-roll under the new
   * ancestors). Invalid sources are skipped per `getMovePlan`; fires
   * `onMove` with the applied moves and returns them ([] when nothing
   * applied).
   */
  movePaths(
    sourcePaths: readonly string[],
    targetGroupPath: string
  ): AccountMove[] {
    const moves = this.getMovePlan(sourcePaths, targetGroupPath);
    if (moves.length === 0) {
      return moves;
    }
    this.applyRemap(moves, {});
    for (const listener of this.moveListeners) {
      listener(moves);
    }
    return moves;
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
   */
  private applyRemap(
    moves: readonly AccountMove[],
    extra: Partial<AccountTreeChange>
  ): void {
    if (moves.length === 0) {
      return;
    }
    const remap = (path: string): string => remapPathThrough(moves, path);

    // Snapshot collapsed groups before the rebuild (the fresh store defaults
    // to fully expanded), remapped onto their new paths.
    const collapsedGroups: string[] = [];
    for (const path of this.groupPaths) {
      if (!this.store.isExpanded(path)) {
        collapsedGroups.push(remap(path));
      }
    }

    this.entries = this.entries.map((entry) => remapEntry(entry, moves));
    this.accounts = this.accounts.map(remap);

    let selectionChanged = false;
    const remappedSelection: string[] = [];
    for (const path of this.selection) {
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
      this.selectionAnchor = remap(this.selectionAnchor);
    }
    let focusChanged = false;
    if (this.focusedPath != null) {
      const next = remap(this.focusedPath);
      focusChanged = next !== this.focusedPath;
      this.focusedPath = next;
    }
    if (this.renamingPath != null) {
      this.renamingPath = remap(this.renamingPath);
    }

    // Status decorations follow their accounts; distinct old paths can only
    // collide onto one new path through pathological move lists, but merge
    // instead of dropping data if they ever do.
    const remappedStatus = new Map<string, StatusAggregate>();
    for (const [path, aggregate] of this.ownStatus) {
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
        priorExpandedGroups: this.searchSession.priorExpandedGroups.map(remap),
      };
      const remappedMatches = new Set<string>();
      for (const match of this.searchMatches) {
        remappedMatches.add(remap(match));
      }
      this.searchMatches = remappedMatches;
    }

    this.store = this.buildStore(this.entries, this.accounts);
    for (const path of collapsedGroups) {
      this.store.setExpanded(path, false);
    }
    this.rebuildStatusRollup();
    this.invalidateVisibleCache();
    this.emit({
      ...NO_CHANGE,
      expansionChanged: true,
      statusChanged: this.ownStatus.size > 0,
      selectionChanged,
      focusChanged,
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
   */
  private ensureProjection(): ProjectionRow[] {
    if (this.projectionCache != null) {
      return this.projectionCache;
    }
    const projection: ProjectionRow[] = [];
    const paths: string[] = [];
    this.visibleIndexByPath = new Map();

    interface Frame {
      path: string;
      depth: number;
      posInSet: number;
      setSize: number;
    }
    const stack: Frame[] = [];
    const roots = this.childrenByParent.get('') ?? [];
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      stack.push({
        path: roots[index],
        depth: 0,
        posInSet: index + 1,
        setSize: roots.length,
      });
    }

    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame == null) {
        break;
      }
      // Flatten single-child group chains: follow the chain while the
      // current group has exactly one child and that child is a group.
      let rowPath = frame.path;
      let flattenedNames: string[] | null = null;
      if (this.flattenEmptyGroups) {
        let chainNames: string[] | null = null;
        while (this.groupPaths.has(rowPath)) {
          const children = this.childrenByParent.get(rowPath);
          if (
            children == null ||
            children.length !== 1 ||
            !this.groupPaths.has(children[0])
          ) {
            break;
          }
          chainNames ??= [getAccountLeafName(frame.path)];
          rowPath = children[0];
          chainNames.push(getAccountLeafName(rowPath));
        }
        flattenedNames = chainNames;
      }

      const isGroup = this.groupPaths.has(rowPath);
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
        const children = this.childrenByParent.get(rowPath) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({
            path: children[index],
            depth: frame.depth + 1,
            posInSet: index + 1,
            setSize: children.length,
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
      !change.renameChanged
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
