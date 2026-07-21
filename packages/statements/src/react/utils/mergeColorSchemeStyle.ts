import type { CSSProperties } from 'react';

import type { ColorScheme } from '../../types';

// Folds a pinned color scheme into the style React puts on the
// <statements-container> host, so the inline `color-scheme` is present in
// server-rendered markup and light-dark() resolves to the requested mode on
// first paint. Caller-provided style wins on conflict (spread last).
export function mergeColorSchemeStyle(
  colorScheme: ColorScheme | undefined,
  style: CSSProperties | undefined
): CSSProperties | undefined {
  if (colorScheme === 'light' || colorScheme === 'dark') {
    return { colorScheme, ...style };
  }
  return style;
}
