import { ImportError } from './errors';
import type {
  BalanceBreak,
  BalanceProof,
  ImportedStatementLine,
  MinorUnits,
} from './types';

/**
 * Verifies the source's own running-balance column against the parsed
 * amounts: `opening + Σ amounts` must equal every line's claimed balance to
 * the minor unit. This is the import-side analog of a trial balance tie —
 * computed and REPORTED, never repaired: a break means lines are missing,
 * duplicated, or mis-parsed, and importers never invent data to paper over
 * that, so the caller gets every break with its exact location instead of a
 * silently "fixed" import.
 *
 * When `opening` is omitted it is anchored off the first line
 * (`first.balance − first.amount`) — derived from the source's own numbers,
 * not invented — so the proof still catches any break from the second line
 * on. A line without a balance throws `BALANCE_MISSING`: proving against a
 * column that is not there would be meaningless.
 */
export function proveRunningBalance(
  lines: readonly ImportedStatementLine[],
  opening?: MinorUnits
): BalanceProof {
  if (lines.length === 0) return { ok: true };

  const first = lines[0];
  if (first.balance === undefined) {
    throw new ImportError(
      'BALANCE_MISSING',
      'line at index 0 has no balance; the source must provide a balance column to prove'
    );
  }
  let running = opening ?? first.balance - first.amount;

  const breaks: BalanceBreak[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.balance === undefined) {
      throw new ImportError(
        'BALANCE_MISSING',
        `line at index ${index} has no balance; the source must provide a balance column to prove`
      );
    }
    running += line.amount;
    if (running !== line.balance) {
      breaks.push({ index, expected: running, actual: line.balance });
      // Re-anchor on the claimed balance so one break reports once instead
      // of cascading into a break on every subsequent line.
      running = line.balance;
    }
  }

  return breaks.length === 0 ? { ok: true } : { ok: false, breaks };
}
