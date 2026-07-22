// Locale-shaped amount presentation. Formatting descriptors are part of the
// money kernel, not the renderers: SSR, worker, and client must produce
// byte-identical amount strings, so the descriptor shape and the shared
// presets live here in the engine and every rendering package imports the
// same objects instead of carrying copies.

/**
 * Locale-shaped amount presentation: which separators to use and how to
 * group integer digits. Plain data by design — it survives structured clone
 * (the worker protocol) and JSON (SSR options) unchanged, which is what lets
 * SSR, worker, and client render byte-identical amounts. Renderers must
 * NEVER consult Intl.NumberFormat for this (ICU tables differ between Node
 * versions and browsers, so the same locale can format differently on
 * server and client); hosts resolve a descriptor once at their boundary
 * (see each package's `resolveAmountFormat`) and thread the same object
 * everywhere.
 */
export interface AmountFormat {
  /** Decimal separator, e.g. `.` or `,`. */
  decimal: string;
  /**
   * Group separator, e.g. `,`, `.`, `\u202f` (narrow no-break space), `'`.
   * An empty string disables grouping entirely.
   */
  group: string;
  /**
   * Group sizes from the decimal point outward; the LAST size repeats for
   * the remaining digits. `[3]` gives `1,234,567`; `[3,2]` gives the Indian
   * `12,34,567`.
   */
  groupSizes: readonly number[];
}

/*
 * Named amount-format presets ({@link AmountFormat} descriptors). Frozen so
 * a shared preset can never be mutated into disagreeing bytes between two
 * render surfaces holding the same reference.
 */

/** `1,234.56` — the default; the suite's original output bytes. */
export const AMOUNT_FORMAT_COMMA_DOT: AmountFormat = Object.freeze({
  decimal: '.',
  group: ',',
  groupSizes: Object.freeze([3]),
});

/** `1.234,56` — continental European convention. */
export const AMOUNT_FORMAT_DOT_COMMA: AmountFormat = Object.freeze({
  decimal: ',',
  group: '.',
  groupSizes: Object.freeze([3]),
});

/**
 * `1 234,56` with a narrow no-break space (U+202F) group separator — the
 * SI/French convention. Narrow no-break so amounts never wrap mid-figure.
 */
export const AMOUNT_FORMAT_SPACE_COMMA: AmountFormat = Object.freeze({
  decimal: ',',
  group: '\u202f',
  groupSizes: Object.freeze([3]),
});

/** `1'234.56` — Swiss convention. */
export const AMOUNT_FORMAT_APOSTROPHE_DOT: AmountFormat = Object.freeze({
  decimal: '.',
  group: "'",
  groupSizes: Object.freeze([3]),
});

/**
 * `12,34,567.89` — Indian lakh/crore grouping: three digits next to the
 * decimal point, then twos.
 */
export const AMOUNT_FORMAT_INDIAN: AmountFormat = Object.freeze({
  decimal: '.',
  group: ',',
  groupSizes: Object.freeze([3, 2]),
});
