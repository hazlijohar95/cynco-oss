import type { RowRange, VirtualWindowSpecs } from '../types';

export interface ComputeGroupedRowWindowProps {
  windowSpecs: VirtualWindowSpecs;
  /** Top of the first model row within the scroll content, in px (section offset + header). */
  bodyTop: number;
  /**
   * Cumulative offsets from `computeRowModelOffsets`: offsets[i] = top of
   * model row i, offsets[length - 1] = total height. Length = rowCount + 1.
   */
  offsets: Float64Array;
  overscanRows: number;
}

// Maps the Virtualizer's pixel window onto `[start, end)` model-row indices
// for a mixed-height (grouped) register. Two binary searches over the prefix
// sums keep windowing O(log n) — never a per-row walk — and for uniform
// heights this returns exactly what computeRowWindow's arithmetic would.
// Returns an empty range when the window misses the section entirely.
export function computeGroupedRowWindow({
  windowSpecs,
  bodyTop,
  offsets,
  overscanRows,
}: ComputeGroupedRowWindowProps): RowRange {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0) {
    return { start: 0, end: 0 };
  }
  const top = windowSpecs.top - bodyTop;
  const bottom = windowSpecs.bottom - bodyTop;
  // Windows that miss the section entirely produce an empty range instead of
  // an overscan-padded sliver: overscan exists to pre-render rows NEAR the
  // viewport, not to keep fully offscreen sections warm.
  if (bottom <= offsets[0] || top >= offsets[rowCount]) {
    return { start: 0, end: 0 };
  }
  // Start: the row containing `top` (largest i with offsets[i] <= top).
  const start = Math.max(0, upperBound(offsets, top) - 1 - overscanRows);
  // End: the first row starting at or past `bottom` (rows before it overlap
  // the window).
  const end = Math.min(rowCount, lowerBound(offsets, bottom) + overscanRows);
  return {
    start: Math.min(start, rowCount),
    end: Math.max(end, Math.min(start, rowCount)),
  };
}

// First index whose offset is >= value (offsets are strictly increasing for
// positive heights, non-decreasing in general).
function lowerBound(offsets: Float64Array, value: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

// First index whose offset is > value.
function upperBound(offsets: Float64Array, value: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
