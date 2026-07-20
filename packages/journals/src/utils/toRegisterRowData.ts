import type { LedgerEntry, Posting, RegisterRowData } from '../types';

/**
 * The register-row shape `@cynco/ledger-core` returns from
 * `EntryStore.getRegisterRows`: the running balance is a single number in the
 * posting's own currency. Declared structurally here (not imported) so
 * `@cynco/journals` stays free of a hard dependency on the data layer while
 * still type-checking the boundary the moment the two are wired together.
 */
export interface LedgerCoreRegisterRow {
  entry: LedgerEntry;
  posting: Posting;
  /** Own-currency running balance after this posting, in minor units. */
  runningBalance: number;
}

/**
 * Adapts a `@cynco/ledger-core` register row into the renderer's
 * {@link RegisterRowData}. The data layer carries the running balance as a
 * plain own-currency number; the renderer expects a per-currency map but only
 * ever reads the posting's own currency, so the conversion is a single-entry
 * map keyed by `posting.currency`.
 *
 * Kept as one small, tested boundary function rather than an inline reshape at
 * every call site: it is the single place the "number vs. per-currency map"
 * seam between the two packages is crossed, so if either side's shape changes
 * the break surfaces here (and in this file's test) instead of as a runtime
 * `.get is not a function` deep inside the renderer.
 */
export function toRegisterRowData(row: LedgerCoreRegisterRow): RegisterRowData {
  return {
    entry: row.entry,
    posting: row.posting,
    runningBalance: new Map([[row.posting.currency, row.runningBalance]]),
  };
}
