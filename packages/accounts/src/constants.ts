import { DEFAULT_CURRENCY_EXPONENTS } from '@cynco/ledger-core';

import type { AccountTreeDensity, AmountFormat } from './types';

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
 * Named amount-format presets ({@link AmountFormat} descriptors). Frozen so
 * a shared preset can never be mutated into disagreeing bytes between two
 * render surfaces holding the same reference.
 *
 * MUST mirror the presets in `@cynco/journals/src/constants.ts` and
 * `@cynco/statements/src/constants.ts`. The packages deliberately share no
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

/**
 * ISO 4217 minor-unit exceptions. Currencies not listed here use 2 decimal
 * places. Commodity codes (stock tickers, points) also fall back to 2.
 *
 * Aliased from the engine's canonical table so the tree and the statements
 * package always scale the same ledger identically — a local copy drifted
 * once (5 exceptions vs the engine's ~26) and mis-scaled zero- and
 * three-decimal currencies 100×/10× relative to `@cynco/statements`.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> =
  DEFAULT_CURRENCY_EXPONENTS;
