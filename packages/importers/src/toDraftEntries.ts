import type {
  LedgerEntry,
  StatementLine,
  ToDraftEntriesOptions,
} from './types';
import { negateMinorUnits } from './utils/negateMinorUnits';

/**
 * Lifts single-sided statement lines into BALANCED draft ledger entries: the
 * bank posting carries the line's signed amount and the counterposting goes
 * to the suspense account with the exact negation, so `Σ postings = 0` per
 * entry by construction — the data layer never emits an unbalanced entry,
 * even a draft. The suspense account is explicit (e.g. `Equity:Suspense`)
 * because classification is a human/rules decision that happens AFTER
 * import; the flag stays `pending` until someone reclassifies and clears.
 *
 * Entry ids are `<account>:<line id>` — the line id is already deterministic
 * (FITID for OFX, content hash for CSV), so re-running the same import
 * produces byte-identical entries and hosts can upsert instead of duplicate.
 */
export function toDraftEntries(
  lines: readonly StatementLine[],
  options: ToDraftEntriesOptions
): LedgerEntry[] {
  return lines.map((line): LedgerEntry => {
    const currency = options.currency ?? line.currency;
    return {
      id: `${options.account}:${line.id}`,
      date: line.date,
      flag: 'pending',
      payee: null,
      narration: line.description,
      tags: [],
      links: [],
      postings: [
        { account: options.account, amount: line.amount, currency },
        {
          account: options.suspenseAccount,
          amount: negateMinorUnits(line.amount),
          currency,
        },
      ],
    };
  });
}
