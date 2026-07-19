import type { SmoothScrollSettings } from './types';

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

/**
 * Fallback viewport height in px for keyboard paging/focus-reveal math when
 * the scroller reports no layout height (jsdom, pre-layout mounts). Matches
 * the accounts tree's fallback so both packages page identically in tests.
 */
export const DEFAULT_VIEWPORT_HEIGHT = 400;

/**
 * Extra vertical padding on a group header row beyond one text line, in px.
 * Group headers mirror the register header's shape (1lh + fixed padding) and
 * — like it — do NOT scale with density; only entry rows do. The JS group
 * row height is `lineHeight + GROUP_HEADER_EXTRA_HEIGHT` and must match the
 * `height` on `[data-group-row]` in style.css (1lh + 8px) or virtualized
 * spacer heights drift from layout.
 */
export const GROUP_HEADER_EXTRA_HEIGHT = 8;

/** Default group header row height (DEFAULT_LINE_HEIGHT + GROUP_HEADER_EXTRA_HEIGHT). */
export const DEFAULT_GROUP_HEADER_HEIGHT: number =
  DEFAULT_LINE_HEIGHT + GROUP_HEADER_EXTRA_HEIGHT;

/**
 * Cap on the character length of a header field eligible for word-level
 * diffing (Pierre's maxLineDiffLength). Fields longer than this on either
 * side skip the O(words²) LCS and render as wholly changed instead.
 */
export const MAX_FIELD_DIFF_LENGTH = 1000;

/**
 * Default spring tuning for smooth programmatic scrolls. Critically damped
 * (see {@link SmoothScrollSettings}): the damping ratio is pinned at exactly
 * 1, so the closed-form position/velocity step can never overshoot the
 * target regardless of frame timing — `omega` is the only stiffness knob.
 * 0.015 rad/ms ≈ a 440ms glide to 99% settle.
 */
export const DEFAULT_SMOOTH_SCROLL_SETTINGS: SmoothScrollSettings = {
  omega: 0.015,
  epsilonPx: 0.5,
  epsilonVelocity: 0.05,
};

/**
 * Upper bound on the frame delta (ms) fed into the spring step. Background
 * tabs throttle rAF to seconds-long gaps; without a clamp the first frame
 * after tab-wake would advance the spring almost to its target and the
 * scroll would appear to teleport instead of glide.
 */
export const MAX_SMOOTH_SCROLL_FRAME_DT = 50;

/**
 * Per-section cap on rows emitted by `preloadLedgerViewHTML`. The server
 * cannot know the viewport, but a section deeper than ~2 viewports of rows
 * only inflates payload — the client re-windows on its first virtualized
 * pass anyway. Sized spacers keep pre-hydration scrollbar geometry exact
 * for the rows not emitted.
 */
export const SSR_MAX_PRELOADED_ROWS_PER_SECTION = 128;

/**
 * Total cap on rows emitted across ALL sections by `preloadLedgerViewHTML`
 * (the accounts package's SSR_MAX_PRELOADED_ROWS convention, same 512
 * budget): a 50-account view must not preload thousands of rows. Leading
 * sections win — they are what the user sees before hydration.
 */
export const SSR_MAX_PRELOADED_TOTAL_ROWS = 512;

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
