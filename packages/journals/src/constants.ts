export const JOURNALS_TAG_NAME = 'journals-container' as const;

/**
 * Default type metrics. These mirror the CSS custom properties
 * `--journals-font-size` / `--journals-line-height`; JS-side row math and the
 * stylesheet must agree or virtualized spacer heights drift from layout.
 */
export const DEFAULT_FONT_SIZE = 13;
export const DEFAULT_LINE_HEIGHT = 20;

/**
 * Default sticky register header height in pixels. Must match the
 * `min-height` on `[data-register-header]` in style.css (1lh + 24px padding).
 */
export const DEFAULT_HEADER_HEIGHT = 44;

/** Extra rows rendered above and below the visible window. */
export const DEFAULT_OVERSCAN_ROWS = 10;

/** Proper minus sign (U+2212) used for credit amounts and negative balances. */
export const MINUS_SIGN = '\u2212';

/**
 * ISO 4217 minor-unit exceptions. Currencies not listed here use 2 decimal
 * places. Commodity codes (stock tickers, points) also fall back to 2.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  BHD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
};
