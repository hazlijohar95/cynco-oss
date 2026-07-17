import type { RowRange, VirtualWindowSpecs } from '../types';

export interface ComputeRowWindowProps {
  windowSpecs: VirtualWindowSpecs;
  /** Top of the first row within the scroll content, in px (section offset + header). */
  bodyTop: number;
  rowHeight: number;
  rowCount: number;
  overscanRows: number;
}

// Maps the Virtualizer's pixel window onto `[start, end)` row indices for a
// fixed-row-height register. Pure arithmetic — no DOM reads — so the same
// function drives client windowing and deterministic tests. Returns an empty
// range (start === end) when the window misses the section entirely.
export function computeRowWindow({
  windowSpecs,
  bodyTop,
  rowHeight,
  rowCount,
  overscanRows,
}: ComputeRowWindowProps): RowRange {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const start = Math.max(
    0,
    Math.floor((windowSpecs.top - bodyTop) / rowHeight) - overscanRows
  );
  const end = Math.min(
    rowCount,
    Math.ceil((windowSpecs.bottom - bodyTop) / rowHeight) + overscanRows
  );
  return { start: Math.min(start, rowCount), end: Math.max(end, start) };
}
