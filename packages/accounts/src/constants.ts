import type { AccountTreeDensity } from './types';

export const ACCOUNTS_TAG_NAME = 'accounts-container' as const;

/**
 * Fixed pixel row height per density preset. These mirror the CSS custom
 * property `--accounts-row-height` (`calc(30px * scale)` with scale 0.8 / 1 /
 * 1.2); JS-side window math and the stylesheet must agree or virtualized
 * spacer heights drift from real layout.
 */
export const DENSITY_ROW_HEIGHTS: Readonly<Record<AccountTreeDensity, number>> =
  {
    compact: 24,
    default: 30,
    relaxed: 36,
  };

/**
 * Unitless density scale factor per preset, mirrored by the stylesheet's
 * `--accounts-density-scale` (multiplies paddings, gaps, and radii).
 */
export const DENSITY_SCALE_FACTORS: Readonly<
  Record<AccountTreeDensity, number>
> = {
  compact: 0.8,
  default: 1,
  relaxed: 1.2,
};

/** Extra rows rendered above and below the visible pixel window. */
export const DEFAULT_OVERSCAN_ROWS = 10;

/**
 * Viewport height assumed when the scroller has no measurable layout yet
 * (SSR, first paint, jsdom). Matches Pierre trees' default projection.
 */
export const DEFAULT_VIEWPORT_HEIGHT = 420;

/** Primary display currency when the caller does not specify one. */
export const DEFAULT_CURRENCY = 'MYR';

/**
 * SSR preload row cap: `preloadAccountTreeHTML` renders at most this many
 * rows (the deferred-projection cap, mirroring Pierre trees). The server
 * cannot know the viewport, and 512 fixed-height rows comfortably cover any
 * initial screen while keeping the HTML payload bounded; the client
 * re-windows on its first scroll.
 */
export const SSR_MAX_PRELOADED_ROWS = 512;

/** Proper minus sign (U+2212) used for negative balances. */
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
