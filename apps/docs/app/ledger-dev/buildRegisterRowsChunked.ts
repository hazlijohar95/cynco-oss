import type { MinorUnits, RegisterRowData } from '@cynco/journals';
import type { CooperativeScheduler, EntryStore } from '@cynco/ledger-core';

// How many register rows one inner iteration pulls from the store before
// re-checking the slice deadline. Small enough that a batch finishes well
// inside the scheduler's 8ms budget even on slow hardware, large enough
// that the per-batch range-read overhead stays negligible at 350k rows.
const ROWS_PER_BATCH = 2048;

/**
 * Time-sliced variant of `examples/buildRegisterRows` for the performance
 * lab: the same projection (single-currency running-balance map per row,
 * full per-currency closing balances folded into the LAST row for the
 * sticky header), but pulled from the store in bounded range reads through
 * the cooperative scheduler so a 350k-row projection never blocks input or
 * paint. The store's warm register reads are index lookups over cached
 * prefix sums, so chunking adds no asymptotic cost — one O(rows) pass total.
 */
export function buildRegisterRowsChunked(
  scheduler: CooperativeScheduler,
  store: EntryStore,
  account: string
): Promise<RegisterRowData[]> {
  const count = store.getRegisterRowCount(account);
  const rows: RegisterRowData[] = new Array<RegisterRowData>(count);
  const closingBalances = new Map<string, MinorUnits>();
  let cursor = 0;
  return scheduler.schedule((deadline) => {
    // The first batch runs unconditionally (a fresh slice always has budget
    // at entry); subsequent batches run while budget remains.
    do {
      const end = Math.min(cursor + ROWS_PER_BATCH, count);
      const slice = store.getRegisterRows(account, { start: cursor, end });
      for (let index = 0; index < slice.length; index += 1) {
        const { entry, posting, runningBalance } = slice[index];
        closingBalances.set(posting.currency, runningBalance);
        rows[cursor + index] = {
          entry,
          posting,
          runningBalance: new Map([[posting.currency, runningBalance]]),
        };
      }
      cursor = end;
    } while (cursor < count && deadline.timeRemaining() > 0);
    if (cursor < count) {
      return { done: false };
    }
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      rows[rows.length - 1] = {
        entry: last.entry,
        posting: last.posting,
        runningBalance: closingBalances,
      };
    }
    return { done: true, value: rows };
  });
}
