import type { AmountFormat } from './types';

export const STATEMENTS_TAG_NAME = 'statements-container' as const;

/** Proper minus sign (U+2212) used for negative amounts and differences. */
export const MINUS_SIGN = '\u2212';

/*
 * Named amount-format presets ({@link AmountFormat} descriptors). Frozen so
 * a shared preset can never be mutated into disagreeing bytes between two
 * render surfaces holding the same reference.
 *
 * MUST mirror the presets in `@cynco/journals/src/constants.ts` and
 * `@cynco/accounts/src/constants.ts`. The packages deliberately share no
 * runtime dependency for these, so the presets are duplicated — and
 * duplication is exactly how the currency table once drifted (a partial
 * copy mis-scaled zero- and three-decimal currencies 100×/10×), so treat
 * any edit here as an edit to all three files.
 */

/** `1,234.56` — the default; the package's original output bytes. */
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
