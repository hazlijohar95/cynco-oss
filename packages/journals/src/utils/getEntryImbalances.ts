import type { LedgerEntry, MinorUnits } from '../types';

// Sums posting amounts per currency and returns only the currencies whose
// sum is non-zero. Balanced entries produce an empty map. The renderer flags
// imbalances but never repairs them — that is the data layer's contract.
export function getEntryImbalances(
  entry: LedgerEntry
): Map<string, MinorUnits> {
  const sums = new Map<string, MinorUnits>();
  for (const posting of entry.postings) {
    sums.set(
      posting.currency,
      (sums.get(posting.currency) ?? 0) + posting.amount
    );
  }
  for (const [currency, sum] of sums) {
    if (sum === 0) {
      sums.delete(currency);
    }
  }
  return sums;
}
