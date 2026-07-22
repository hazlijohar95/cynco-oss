export const STATEMENTS_TAG_NAME = 'statements-container' as const;

/** Proper minus sign (U+2212) used for negative amounts and differences. */
export const MINUS_SIGN = '\u2212';

/*
 * Named amount-format presets come from the engine — one canonical
 * definition for the whole suite. Re-exported so this package's public API
 * keeps offering them under the names it always has.
 */
export {
  AMOUNT_FORMAT_APOSTROPHE_DOT,
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  AMOUNT_FORMAT_INDIAN,
  AMOUNT_FORMAT_SPACE_COMMA,
} from '@cynco/ledger-core';
