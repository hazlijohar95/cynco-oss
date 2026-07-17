import type { VirtualWindowSpecs } from '../types';

export interface WindowFromScrollPositionProps {
  scrollTop: number;
  height: number;
  scrollHeight: number;
  overscrollSize: number;
}

// Converts a scroll position into the pixel window that should have real
// rows in the DOM: the viewport extended by `overscrollSize` on both sides,
// clamped to the scrollable content. Registers translate this pixel window
// into row indices with plain arithmetic (fixed row heights), so the window
// itself stays unit-agnostic.
export function createWindowFromScrollPosition({
  scrollTop,
  height,
  scrollHeight,
  overscrollSize,
}: WindowFromScrollPositionProps): VirtualWindowSpecs {
  const top = Math.max(0, Math.floor(scrollTop - overscrollSize));
  const bottom = Math.min(
    Math.max(scrollHeight, height),
    Math.ceil(scrollTop + height + overscrollSize)
  );
  return { top, bottom: Math.max(bottom, top) };
}
