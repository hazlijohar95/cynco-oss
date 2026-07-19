// Maps a pixel offset (relative to the register body top) onto the model
// row containing it: the largest index i with offsets[i] <= y, i.e. the row
// whose [offsets[i], offsets[i+1]) span covers y. Exists so the sticky
// period label resolves "which row is at the seam" in O(log n) against the
// same prefix sums the window math uses — never a per-row walk per frame.
// Returns -1 when y precedes the first row and the last row's index when y
// runs past the content (callers treat the register as still "in" its final
// period while its tail scrolls by).
export function findRowIndexAtOffset(offsets: Float64Array, y: number): number {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0 || y < offsets[0]) {
    return -1;
  }
  // Binary search over [0, rowCount): find the last i with offsets[i] <= y.
  let low = 0;
  let high = rowCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= y) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.min(low - 1, rowCount - 1);
}
