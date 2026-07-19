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
 * One line of a single-account register: the entry it came from, the posting
 * that touches this account, and the running balance after applying it.
 * Produced by a data layer (later `@cynco/ledger-store`); the components only
 * consume plain data.
 */
export interface RegisterRowData {
  entry: LedgerEntry;
  posting: Posting;
  /** Running balance per currency after this posting, in minor units. */
  runningBalance: ReadonlyMap<string, MinorUnits>;
}

/**
 * Register row density. `comfortable` gives payee and narration their own
 * lines (row height = 2 line-heights); `compact` renders one line per row.
 */
export type RegisterDensity = 'comfortable' | 'compact';

/**
 * Period grouping for register rows. `none` (default) keeps the flat
 * fixed-height fast path; the calendar options interleave group header rows
 * into the virtual row space at month/quarter/year boundaries.
 */
export type RegisterGroupBy = 'none' | 'month' | 'quarter' | 'year';

/**
 * Summary line for one period group: deterministic key, locale-free English
 * label, distinct-entry count, and the net change per currency across the
 * period's postings (integer minor units, never floats).
 */
export interface RegisterGroupSummary {
  /** Deterministic period key, e.g. `2026-03`, `2026-Q1`, `2026`. */
  key: string;
  /** Locale-free English label, e.g. `March 2026`, `Q1 2026`, `2026`. */
  label: string;
  /** Number of distinct entries touching the account within the period. */
  entryCount: number;
  /**
   * Net change per currency for the period, in minor units. Insertion order
   * follows first appearance in the period's rows, so it is deterministic
   * for a given input.
   */
  netChange: ReadonlyMap<string, MinorUnits>;
}

/** A period group header interleaved into the register's virtual row space. */
export interface RegisterGroupVirtualRow {
  kind: 'group';
  group: RegisterGroupSummary;
}

/**
 * An entry row inside the grouped row model. `entryIndex` is the row's index
 * in the ORIGINAL flat rows array — selection, `data-row-index`, and every
 * callback stay in entry-index space regardless of grouping.
 */
export interface RegisterEntryVirtualRow {
  kind: 'entry';
  row: RegisterRowData;
  entryIndex: number;
}

/**
 * One slot of the grouped register's virtual row space: either a period
 * header or an entry row. Built once per data update in a single O(n) pass.
 */
export type RegisterVirtualRow =
  | RegisterGroupVirtualRow
  | RegisterEntryVirtualRow;

/**
 * Row selection behavior. `single` (default) keeps the original one-row
 * selection; `range` adds shift-click contiguous extension and
 * meta/ctrl-click toggling (Pierre line-selection style, pointer-only).
 */
export type RegisterSelectionMode = 'single' | 'range';

/**
 * Register selection state: the anchor row shift-ranges extend from, plus
 * the selected entry indexes (always entry-index space — group header rows
 * are never selectable).
 */
export interface RegisterSelection {
  anchor: number | null;
  indexes: ReadonlySet<number>;
}

/** Payload for `RegisterOptions.onSelectionChange`: sorted entry indexes plus their rows. */
export interface RegisterSelectionChange {
  indexes: number[];
  rows: RegisterRowData[];
}

/** One line from a bank statement, already parsed to integer minor units. */
export interface StatementLine {
  /** Stable unique id (caller-provided). */
  id: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  description: string;
  /** Signed from the account's perspective: deposits positive. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. `MYR`. */
  currency: string;
}

/**
 * A book-side posting reference: the entry plus which posting targets the
 * reconciled account.
 */
export interface BookPostingRef {
  entry: LedgerEntry;
  /** Index into `entry.postings` of the posting hitting the account. */
  postingIndex: number;
}

/**
 * How a match was made: `exact` (same amount, currency, and date),
 * `suggested` (same amount and currency within the date window), `sum` (one
 * statement line covered by the sum of several postings), or `manual`
 * (caller-constructed).
 */
export type MatchKind = 'exact' | 'suggested' | 'sum' | 'manual';

/** Lifecycle of a match inside the reconciliation UI. */
export type MatchStatus = 'proposed' | 'accepted' | 'rejected';

export interface ReconciliationMatch {
  /**
   * Deterministic id: `m-<lineId>-<entryId>-<postingIndex>` joined with `+`
   * across postings for sum matches.
   */
  id: string;
  statementLineId: string;
  /**
   * Book postings covering the statement line. Exactly one for
   * exact/suggested matches; 2..maxGroupSize for `sum` matches. Their
   * amounts sum to the statement line amount in its currency.
   */
  postings: readonly BookPostingRef[];
  kind: MatchKind;
  status: MatchStatus;
  /**
   * Days between statement and book dates (book − statement; 0 for exact).
   * For sum matches this is the group's largest-magnitude signed delta.
   */
  dateDelta: number;
}

/**
 * Tuning knobs for the critically-damped spring that drives smooth
 * programmatic scrolling. Critically damped means the spring approaches the
 * target as fast as possible WITHOUT overshooting — scroll positions must
 * never bounce past a row and come back. `omega` is the spring's natural
 * frequency in rad/ms: 99% settle takes roughly `6.6 / omega`, so the
 * default 0.015 gives a ~440ms glide; raise it for snappier, lower for
 * longer. The two epsilons gate the settle transition: the animation stops
 * (and snaps exactly onto the target) only once BOTH the remaining distance
 * and the velocity are negligible, so a fast pass-through near the target
 * never ends the animation early.
 */
export interface SmoothScrollSettings {
  /** Natural frequency of the critically-damped spring, in rad/ms. */
  omega: number;
  /** Distance from the target (CSS px) below which the spring may settle. */
  epsilonPx: number;
  /** Velocity magnitude (CSS px/ms) below which the spring may settle. */
  epsilonVelocity: number;
}

/**
 * Options shared by every scroll-to API (`Register.scrollToRow`,
 * `Register.scrollToDate`, `LedgerView.scrollToSection`,
 * `LedgerView.scrollToRow`). `align` positions the target within the
 * viewport: `start` puts it at the top (just below any sticky header),
 * `center` centers it, `nearest` moves the minimum distance needed to make
 * it fully visible (a no-op when it already is). `behavior: 'smooth'` runs
 * the critically-damped spring; `'auto'` (default) jumps instantly —
 * smooth is opt-in, and reduced-motion users always get the instant jump.
 */
export interface ScrollToRowOptions {
  align?: 'start' | 'center' | 'nearest';
  behavior?: 'smooth' | 'auto';
}

/**
 * Pixel window (relative to scroll content top) that should have real DOM.
 * Produced by the Virtualizer from scroll position plus overscroll.
 */
export interface VirtualWindowSpecs {
  top: number;
  bottom: number;
}

/** Contiguous `[start, end)` row range a Register currently has in the DOM. */
export interface RowRange {
  start: number;
  end: number;
}

/** Classification of one header field between two entry versions. */
export type FieldChangeKind = 'unchanged' | 'changed' | 'added' | 'removed';

/**
 * One run of a word-level diff: `changed` runs get highlight spans, the rest
 * render as plain text. Adjacent runs separated by a single space are merged
 * (the Pierre "word-alt" join) so highlights read as phrases, not confetti.
 */
export interface WordDiffSegment {
  changed: boolean;
  text: string;
}

/**
 * Diff of one scalar header field (date, flag, payee, narration). For
 * `changed` payee/narration the word-level segments are populated unless the
 * field exceeded the diff length cap, in which case both segment lists are
 * null and the whole field renders as changed.
 */
export interface EntryFieldDiff {
  kind: FieldChangeKind;
  before: string | null;
  after: string | null;
  beforeSegments: readonly WordDiffSegment[] | null;
  afterSegments: readonly WordDiffSegment[] | null;
}

/** One tag/link pill in a list diff. */
export interface EntryListItemDiff {
  value: string;
  kind: 'unchanged' | 'added' | 'removed';
}

/**
 * Diff of a tag or link list. Membership-based (tags are sets semantically):
 * items in after-order first (unchanged/added), then removed items in
 * before-order appended at the end.
 */
export interface EntryListDiff {
  kind: FieldChangeKind;
  items: readonly EntryListItemDiff[];
}

/** Classification of one aligned posting between two entry versions. */
export type PostingDiffKind =
  | 'unchanged'
  | 'amount-changed'
  | 'added'
  | 'removed';

/**
 * One aligned posting: postings pair by (account, currency), so both sides
 * of an `amount-changed` pair share account and currency, and the amounts
 * stay integer minor units end to end.
 */
export interface PostingDiff {
  kind: PostingDiffKind;
  /** Canonical colon-delimited account path. */
  account: string;
  currency: string;
  /** Amount in the before version; null for `added` postings. */
  beforeAmount: MinorUnits | null;
  /** Amount in the after version; null for `removed` postings. */
  afterAmount: MinorUnits | null;
}

/** Overall shape of an entry version pair. */
export type EntryVersionDiffKind =
  | 'created'
  | 'deleted'
  | 'modified'
  | 'unchanged';

/**
 * Full diff between two versions of a journal entry — the ledger analog of
 * a file diff. Produced by `diffEntryVersions`, rendered by
 * `renderEntryDiffHTML`, and pure data throughout (no DOM types).
 */
export interface EntryVersionDiff {
  kind: EntryVersionDiffKind;
  before: LedgerEntry | null;
  after: LedgerEntry | null;
  date: EntryFieldDiff;
  flag: EntryFieldDiff;
  payee: EntryFieldDiff;
  narration: EntryFieldDiff;
  tags: EntryListDiff;
  links: EntryListDiff;
  postings: readonly PostingDiff[];
}
