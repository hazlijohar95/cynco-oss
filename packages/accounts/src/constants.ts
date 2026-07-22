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
 * (SSR, first paint, jsdom).
 */
export const DEFAULT_VIEWPORT_HEIGHT = 420;

/** Primary display currency when the caller does not specify one. */
export const DEFAULT_CURRENCY = 'MYR';

/**
 * SSR preload row cap: `preloadAccountTreeHTML` renders at most this many
 * rows (the deferred-projection cap). The server
 * cannot know the viewport, and 512 fixed-height rows comfortably cover any
 * initial screen while keeping the HTML payload bounded; the client
 * re-windows on its first scroll.
 */
export const SSR_MAX_PRELOADED_ROWS = 512;

/**
 * Spring-loaded expansion delay: how long a drag must hover a collapsed
 * group before it auto-expands. Tuned slightly snappier than the common
 * 800ms convention per the accounts spec.
 */
export const DRAG_EXPAND_DELAY_MS = 700;

/**
 * Maximum mirror rows the `stickyAncestors: 'stack'` header renders. Deep
 * charts can nest far past what a breadcrumb should occupy — an unbounded
 * sticky stack eats the viewport it exists to contextualize — so the stack
 * keeps only the NEAREST ancestors (the deepest ones carry the most
 * information about the rows under the cursor; the root is the most
 * guessable). Four rows ≈ one quarter of a 480px viewport at default
 * density, the ceiling the sticky overlays stay comfortable at.
 */
export const STICKY_ANCESTOR_STACK_MAX = 4;

/** Proper minus sign (U+2212) used for negative balances. */
export const MINUS_SIGN = '\u2212';

/*
 * Named amount-format presets and the ISO 4217 minor-unit exponent table
 * come from the engine — one canonical definition for the whole suite.
 * Re-exported so this package's public API keeps offering them under the
 * names it always has.
 */
export {
  AMOUNT_FORMAT_APOSTROPHE_DOT,
  AMOUNT_FORMAT_COMMA_DOT,
  AMOUNT_FORMAT_DOT_COMMA,
  AMOUNT_FORMAT_INDIAN,
  AMOUNT_FORMAT_SPACE_COMMA,
  DEFAULT_CURRENCY_EXPONENTS as CURRENCY_DECIMALS,
} from '@cynco/ledger-core';
