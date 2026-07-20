import type { CooperativeScheduler, LedgerEntry } from '@cynco/ledger-core';

// Entries scanned per inner iteration before re-checking the slice
// deadline. Counting is a cheap Set insert per posting, so 10k entries
// stay comfortably inside one 8ms slice while keeping resume granularity
// fine enough for the 1M-entry workload.
const ENTRIES_PER_BATCH = 10_000;

/**
 * Counts distinct posting accounts across `entries` through the
 * cooperative scheduler, for the lab's stats readout. A plain full-array
 * loop would block ~50-150ms at one million entries; time-slicing it keeps
 * the busy readout animating while the count accumulates. One O(postings)
 * pass total, resumable at entry granularity.
 */
export function countAccountsChunked(
  scheduler: CooperativeScheduler,
  entries: readonly LedgerEntry[]
): Promise<number> {
  const accounts = new Set<string>();
  let cursor = 0;
  return scheduler.schedule((deadline) => {
    do {
      const end = Math.min(cursor + ENTRIES_PER_BATCH, entries.length);
      for (let index = cursor; index < end; index += 1) {
        for (const posting of entries[index].postings) {
          accounts.add(posting.account);
        }
      }
      cursor = end;
    } while (cursor < entries.length && deadline.timeRemaining() > 0);
    return cursor < entries.length
      ? { done: false }
      : { done: true, value: accounts.size };
  });
}
