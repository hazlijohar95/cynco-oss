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
