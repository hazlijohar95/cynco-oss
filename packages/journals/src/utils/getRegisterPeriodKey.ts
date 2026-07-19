import type { RegisterGroupBy } from '../types';

// Period key from an ISO `YYYY-MM-DD` date via string slicing — no Date
// parsing, so grouping is timezone-proof and allocation-light. Malformed
// month digits fall back to the month-style substring key so bad input still
// groups deterministically instead of throwing. Shared by the full and the
// FILTERED row-model builders so their period boundaries can never drift.
export function getRegisterPeriodKey(
  date: string,
  groupBy: Exclude<RegisterGroupBy, 'none'>
): string {
  if (groupBy === 'year') {
    return date.slice(0, 4);
  }
  if (groupBy === 'month') {
    return date.slice(0, 7);
  }
  const month = Number(date.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return date.slice(0, 7);
  }
  return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}
