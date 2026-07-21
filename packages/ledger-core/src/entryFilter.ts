// Pure EntryFilter matching, shared by report derivations that scan plain
// entry arrays. Behavior-identical to EntryStore's internal matcher (which
// keeps its own copy to use the store's precomputed lowercase search corpus);
// the two must stay in lockstep — a filter means the same thing whether it
// scopes a register query or a working-trial-balance adjustment column.

import type { EntryFilter, LedgerEntry } from './types';

/**
 * True when an entry satisfies every present condition of the filter
 * (logical AND, like `EntryStore.filterEntries`). The query condition
 * lowercases per call; hot per-frame paths should prefer the store's cached
 * variant, report derivations scan once and do not care.
 */
export function matchesEntryFilter(
  entry: LedgerEntry,
  filter: EntryFilter
): boolean {
  if (filter.dateFrom != null && entry.date < filter.dateFrom) {
    return false;
  }
  if (filter.dateTo != null && entry.date > filter.dateTo) {
    return false;
  }
  if (filter.flag != null && entry.flag !== filter.flag) {
    return false;
  }
  if (filter.tag != null && !entry.tags.includes(filter.tag)) {
    return false;
  }
  if (filter.query != null && filter.query !== '') {
    const needle = filter.query.toLowerCase();
    const haystack = `${entry.payee ?? ''}\n${entry.narration}`.toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  return true;
}
