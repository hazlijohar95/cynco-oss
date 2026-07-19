import type { RegisterRowData } from '../types';

// Binary search for the first register row dated on or after `isoDate`.
// Register rows are date-sorted (the data layer's contract) and ISO
// `YYYY-MM-DD` strings compare lexicographically in date order, so this is
// a plain string lower-bound — no Date parsing, no timezones. Returns null
// when every row precedes the date (and for empty registers): the caller's
// scroll-to should be a graceful no-op rather than a jump to nowhere.
export function findFirstRowOnOrAfterDate(
  rows: readonly RegisterRowData[],
  isoDate: string
): number | null {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].entry.date < isoDate) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < rows.length ? low : null;
}
