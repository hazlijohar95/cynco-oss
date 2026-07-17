import type { CSSProperties } from 'react';

import type { ColorScheme } from '../../types';

// Folds a pinned color scheme into the style React puts on the
// <accounts-container> host. This matters for the SSR/ssrHTML path: the
// declarative shadow root paints before any JS runs, so the inline
// `color-scheme` must be present in the server markup for light-dark() to
// resolve to the requested mode on first paint. Caller-provided style wins
// on conflict (spread last).
export function mergeColorSchemeStyle(
  colorScheme: ColorScheme | undefined,
  style: CSSProperties | undefined
): CSSProperties | undefined {
  if (colorScheme === 'light' || colorScheme === 'dark') {
    return { colorScheme, ...style };
  }
  return style;
}
