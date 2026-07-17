import type { MinorUnits, RegisterRowData } from '@cynco/journals';
import type { EntryStore } from '@cynco/ledger-store';

// Adapts EntryStore register rows to the shape @cynco/journals consumes.
// The store returns one running balance number in the posting's own
// currency; the renderer wants a per-currency map per row (it reads the
// posting's currency out of it, and the sticky header shows every currency
// present in the LAST row's map). Each row gets a single-entry map — cheap
// and exact — and the final row gets the full per-currency closing balances
// so multi-currency accounts show every balance in the header. One pass,
// O(rows).
export function buildRegisterRows(
  store: EntryStore,
  account: string
): RegisterRowData[] {
  const count = store.getRegisterRowCount(account);
  const storeRows = store.getRegisterRows(account, { start: 0, end: count });
  const rows: RegisterRowData[] = new Array<RegisterRowData>(storeRows.length);
  const closingBalances = new Map<string, MinorUnits>();
  for (let index = 0; index < storeRows.length; index += 1) {
    const { entry, posting, runningBalance } = storeRows[index];
    closingBalances.set(posting.currency, runningBalance);
    rows[index] = {
      entry,
      posting,
      runningBalance: new Map([[posting.currency, runningBalance]]),
    };
  }
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = {
      entry: last.entry,
      posting: last.posting,
      runningBalance: closingBalances,
    };
  }
  return rows;
}
