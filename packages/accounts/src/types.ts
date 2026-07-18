// Public types for @cynco/accounts. The ledger domain shapes are declared
// locally (structurally identical to @cynco/ledger-store's) so the emitted
// declaration files never import the private engine package — the engine is
// inlined into dist at build time and must not leak as a type import either.

/** Integer minor units (sen, cents). Never floats. */
export type MinorUnits = number;

/**
 * How the component's `light-dark()` color defaults resolve. `system`
 * (default) leaves resolution to the page/OS; `light`/`dark` pin the scheme
 * via an inline `color-scheme` on the host element.
 */
export type ColorScheme = 'light' | 'dark' | 'system';

export type EntryFlag = 'cleared' | 'pending' | 'flagged' | 'void';

export interface Posting {
  /** Canonical colon-delimited account path, e.g. `Assets:Current:Cash-Maybank`. */
  account: string;
  /** Signed integer minor units. Positive = debit, negative = credit. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. `MYR`, `USD`. */
  currency: string;
}

export interface LedgerEntry {
  /** Stable unique id (caller-provided). */
  id: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  flag: EntryFlag;
  payee: string | null;
  narration: string;
  tags: readonly string[];
  links: readonly string[];
  postings: readonly Posting[];
}

/**
 * Row density preset. Each preset maps to a fixed pixel row height (compact
 * 24 / default 30 / relaxed 36) and a CSS density scale factor that
 * multiplies paddings, gaps, and radii (0.8 / 1 / 1.2).
 */
export type AccountTreeDensity = 'compact' | 'default' | 'relaxed';

/**
 * Initial expansion of the tree:
 *
 * - `all`: every group expanded (the store default — a chart of accounts is
 *   usually browsed whole).
 * - `top-level`: only depth-0 groups expanded, so depth 0 and depth 1 rows
 *   are visible.
 * - `string[]`: exactly the listed group paths (plus their ancestors, so the
 *   listed groups are actually reachable) are expanded.
 */
export type AccountTreeInitialExpansion = 'all' | 'top-level' | string[];

/**
 * Status decoration kinds — the accounting analog of git file status. Shown
 * as a colored dot (+ optional count) on rows and rolled up onto collapsed
 * ancestor groups.
 */
export type AccountStatusKind = 'unreconciled' | 'flagged' | 'pending';

/** One status decoration entry passed to `setAccountStatus`. */
export interface AccountStatusEntry {
  /** Canonical colon-delimited account path the status applies to. */
  path: string;
  /** Status kind; decides the dot color (warn / danger / info). */
  status: AccountStatusKind;
  /** Item count shown next to the dot (unreconciled entries etc.). Default 1. */
  count?: number;
}

/**
 * One materialized, decoration-complete row of the account tree, as consumed
 * by the pure HTML renderer. Produced per viewport-sized slice by
 * `AccountTreeController.getRows`.
 */
export interface AccountTreeRowData {
  /** Canonical colon-delimited account path. */
  path: string;
  /** Leaf segment of the path (`Cash-Maybank`). */
  name: string;
  /** Zero-based tree depth; top-level accounts are depth 0. */
  depth: number;
  /** `group` when the account has child accounts, `leaf` otherwise. */
  kind: 'group' | 'leaf';
  /** Whether a group row is currently expanded. Always false for leaves. */
  expanded: boolean;
  /** Total number of siblings sharing this row's parent (aria-setsize). */
  setSize: number;
  /** One-based position among those siblings (aria-posinset). */
  posInSet: number;
  /**
   * Rolled-up balance (own + descendants) in the primary display currency,
   * or null when the account has no balance in that currency (the store
   * omits zero balances, so absence means zero).
   */
  balance: MinorUnits | null;
  /** True when the path is in the current selection set. */
  selected: boolean;
  /** True when the path carries keyboard focus. */
  focused: boolean;
  /** True when the path matches the active search session. */
  searchMatch: boolean;
  /**
   * Effective status decoration: the account's own status, or — for
   * collapsed groups — the highest-severity status rolled up from
   * descendants. Null when nothing applies.
   */
  status: AccountStatusKind | null;
  /** Total decorated item count behind `status` (0 when status is null). */
  statusCount: number;
  /**
   * Leaf names of the flattened single-child group chain this row stands in
   * for (`['Income', 'Sales']`), head first. Null for ordinary rows and
   * whenever `flattenEmptyGroups` is off. `path`/`name` always describe the
   * chain's deepest group — the node expansion toggles operate on.
   */
  flattenedNames: readonly string[] | null;
}

/** Half-open `[start, end)` row index range. */
export interface RowRange {
  start: number;
  end: number;
}

/**
 * Honest invalidation info fired to `onChange` listeners after every
 * controller mutation: each flag is true only when that facet actually
 * changed (a no-op setExpanded or re-selecting the same path fires nothing).
 */
export interface AccountTreeChange {
  expansionChanged: boolean;
  selectionChanged: boolean;
  statusChanged: boolean;
  focusChanged: boolean;
  /** True when a rename session started, ended, or was committed. */
  renameChanged: boolean;
}

/** Listener registered via `AccountTreeController.onChange`. */
export type AccountTreeChangeListener = (change: AccountTreeChange) => void;

/** Options bag for `AccountTreeController.selectPath`. */
export interface SelectPathOptions {
  /** Meta/ctrl-click semantics: toggle the path in the selection set. */
  additive?: boolean;
  /**
   * Shift-click semantics: select the visible span between the selection
   * anchor and the path. Combined with `additive`, the span is unioned into
   * the existing selection instead of replacing it.
   */
  range?: boolean;
}

/** Result of `AccountTreeController.beginSearch`. */
export interface AccountSearchResult {
  /** Account paths whose segments match the query, in tree order. */
  matches: readonly string[];
  /**
   * Distinct ancestor group paths of the matches, all expanded by the
   * search session so every match is visible.
   */
  expandedAncestors: readonly string[];
}

/** One re-parenting move applied by rename or drag & drop. */
export interface AccountMove {
  /** Canonical path before the move. */
  from: string;
  /** Canonical path after the move. Never inside `from`'s subtree. */
  to: string;
}

/** Listener registered via `AccountTreeController.onMove`. */
export type AccountMoveListener = (moves: readonly AccountMove[]) => void;

/** Listener registered via `AccountTreeController.onRename`. */
export type AccountRenameListener = (oldPath: string, newPath: string) => void;

/** Why a `commitRename` attempt was rejected. */
export type RenameErrorReason =
  /** The path being renamed is not an account in the tree. */
  | 'unknown-path'
  /** Empty leaf name, or one containing the `:` path separator. */
  | 'invalid-name'
  /** Another account already occupies the resulting path. */
  | 'collision';

/** Result of `AccountTreeController.commitRename`. */
export type RenameResult =
  | { ok: true; newPath: string }
  | { ok: false; reason: RenameErrorReason };

/** Options bag for constructing an `AccountTreeController`. */
export interface AccountTreeControllerOptions {
  /** Entries whose posting accounts seed the tree and its balances. */
  entries?: readonly LedgerEntry[];
  /**
   * Explicit account paths to include even when no posting references them
   * (zero-activity accounts). Invalid paths are skipped silently.
   */
  accounts?: readonly string[];
  /** Initial expansion state. Default `all`. */
  initialExpansion?: AccountTreeInitialExpansion;
  /** Row density preset. Default `default` (30px rows). */
  density?: AccountTreeDensity;
  /** Primary display currency for the balance column. Default `MYR`. */
  currency?: string;
  /** Whether rows render the right-aligned balance column. Default true. */
  showBalances?: boolean;
  /**
   * Collapse single-child GROUP chains into one visible row labelled with
   * the joined segments (`Income : Sales`). Projection-level only: canonical
   * topology, expansion state, selection, and every public API keep
   * canonical paths — the flattened row represents its deepest group, and
   * expansion toggles that node. Default false.
   */
  flattenEmptyGroups?: boolean;
}
