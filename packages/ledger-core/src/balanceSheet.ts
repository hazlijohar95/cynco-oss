// Balance sheet derivation: cumulative position of asset, liability, and
// equity accounts as of one or more dates, one section per currency.
//
// The retained-earnings problem is solved virtually: income and expense
// accounts never physically close in this suite (no closing entries exist to
// fabricate), so each balance sheet column carries computed earnings lines —
// the cumulative P&L result folded into equity at derivation time. With a
// fiscal-year start on a column, the result splits into retained earnings
// (before the fiscal year) and current-year earnings (inside it); without
// one, everything reports as retained earnings. This is what makes the
// statement balance, and it is computed, never booked.

import { negateMinorUnits } from './money';
import type {
  StatementDate,
  StatementLine,
  UnclassifiedBalance,
} from './statements';
import type { AccountTaxonomy } from './taxonomy';
import type { LedgerEntry, MinorUnits } from './types';

/** Options bag for {@link deriveBalanceSheet}. */
export interface BalanceSheetOptions {
  /** Reporting dates, one column each, in display order. At least one. */
  dates: readonly StatementDate[];
  /**
   * Classifies accounts into the three position sections. Without a
   * taxonomy every active account is unclassified and the sections are
   * empty — the statement never guesses.
   */
  taxonomy?: AccountTaxonomy;
}

/** One currency's balance sheet. */
export interface BalanceSheetSection {
  /** ISO 4217 or commodity code this section is denominated in. */
  currency: string;
  /** Asset lines in account-path order, presentation-signed (debit positive). */
  assets: StatementLine[];
  /** Liability lines in account-path order, presentation-signed (credit positive). */
  liabilities: StatementLine[];
  /** Equity lines (booked equity accounts only), presentation-signed (credit positive). */
  equity: StatementLine[];
  /**
   * Computed retained earnings per date column, presentation-signed
   * (positive = cumulative profit): the P&L result before the column's
   * fiscal year, or all-time when the column has no fiscal-year start.
   */
  retainedEarnings: readonly MinorUnits[];
  /**
   * Computed current-year earnings per date column, presentation-signed:
   * the P&L result from the column's fiscal-year start through its as-of
   * date. Zero for columns without a fiscal-year start.
   */
  currentEarnings: readonly MinorUnits[];
  /** Sum of asset lines per date. */
  totalAssets: readonly MinorUnits[];
  /** Sum of liability lines per date. */
  totalLiabilities: readonly MinorUnits[];
  /** Booked equity plus both computed earnings lines, per date. */
  totalEquity: readonly MinorUnits[];
  /**
   * The accounting equation per date: true exactly when assets equal
   * liabilities plus equity. Computed, never asserted — unclassified
   * residue or unbalanced source entries surface here honestly.
   */
  balancedByDate: readonly boolean[];
  /** Active accounts the taxonomy could not place; excluded from all totals. */
  unclassified: UnclassifiedBalance[];
  /** True when any accumulation crossed 2^53; flagged, never repaired. */
  hasOverflow: boolean;
}

/** A derived balance sheet: one section per currency with position activity. */
export interface BalanceSheetData {
  /** The dates the columns report, in column order. */
  dates: readonly StatementDate[];
  /** Sections sorted by currency code. */
  sections: BalanceSheetSection[];
}

interface DateAccumulator {
  /** Cumulative signed balance through each date column. */
  balances: number[];
  /** Signed P&L activity strictly before each column's fiscal-year start. */
  preFiscalYear: number[];
  overflowed: boolean;
}

/**
 * Derives the balance sheet in one pass over the entries. Void entries are
 * excluded from meaning and unsafe posting amounts are skipped, matching
 * every other derivation. Income and expense balances fold into the two
 * computed equity lines rather than appearing as sections — that is the
 * virtual closing.
 */
export function deriveBalanceSheet(
  entries: readonly LedgerEntry[],
  options: BalanceSheetOptions
): BalanceSheetData {
  const { dates, taxonomy } = options;
  const dateCount = dates.length;

  // currency → account → per-column accumulators. Cumulative balances and
  // the pre-fiscal-year split both accumulate in the same single scan.
  const byCurrency = new Map<string, Map<string, DateAccumulator>>();
  for (const entry of entries) {
    if (entry.flag === 'void') {
      continue;
    }
    // Column membership per entry date: cumulative columns include every
    // entry on or before their as-of date.
    let matched: number[] | null = null;
    for (let index = 0; index < dateCount; index += 1) {
      if (entry.date <= dates[index].asOf) {
        (matched ??= []).push(index);
      }
    }
    if (matched == null) {
      continue;
    }
    for (const posting of entry.postings) {
      if (!Number.isSafeInteger(posting.amount)) {
        continue;
      }
      let accounts = byCurrency.get(posting.currency);
      if (accounts == null) {
        accounts = new Map<string, DateAccumulator>();
        byCurrency.set(posting.currency, accounts);
      }
      let accumulator = accounts.get(posting.account);
      if (accumulator == null) {
        accumulator = {
          balances: new Array<number>(dateCount).fill(0),
          preFiscalYear: new Array<number>(dateCount).fill(0),
          overflowed: false,
        };
        accounts.set(posting.account, accumulator);
      }
      for (const column of matched) {
        accumulator.balances[column] += posting.amount;
        const fiscalYearStart = dates[column].fiscalYearStart;
        if (fiscalYearStart != null && entry.date < fiscalYearStart) {
          accumulator.preFiscalYear[column] += posting.amount;
        }
        if (
          !Number.isSafeInteger(accumulator.balances[column]) ||
          !Number.isSafeInteger(accumulator.preFiscalYear[column])
        ) {
          accumulator.overflowed = true;
        }
      }
    }
  }

  const sections: BalanceSheetSection[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const accounts = byCurrency.get(currency) as Map<string, DateAccumulator>;
    const assets: StatementLine[] = [];
    const liabilities: StatementLine[] = [];
    const equity: StatementLine[] = [];
    const unclassified: UnclassifiedBalance[] = [];
    const totalAssets = new Array<number>(dateCount).fill(0);
    const totalLiabilities = new Array<number>(dateCount).fill(0);
    const bookedEquity = new Array<number>(dateCount).fill(0);
    // Signed cumulative P&L balances, split at each column's fiscal-year
    // start. Ledger sign: profit is a net credit, so negative here.
    const earningsAllTime = new Array<number>(dateCount).fill(0);
    const earningsBeforeFiscalYear = new Array<number>(dateCount).fill(0);
    let hasOverflow = false;

    for (const [account, accumulator] of accounts) {
      const active = accumulator.balances.some((balance) => balance !== 0);
      const classification = taxonomy?.classify(account) ?? null;
      if (classification == null) {
        if (active) {
          hasOverflow ||= accumulator.overflowed;
          unclassified.push({ account, amounts: [...accumulator.balances] });
        }
        continue;
      }
      if (classification.statement === 'income-statement') {
        // Virtual closing: P&L balances fold into the computed equity
        // lines instead of appearing as balance sheet lines.
        hasOverflow ||= accumulator.overflowed;
        for (let index = 0; index < dateCount; index += 1) {
          earningsAllTime[index] += accumulator.balances[index];
          earningsBeforeFiscalYear[index] += accumulator.preFiscalYear[index];
        }
        continue;
      }
      if (!active) {
        continue;
      }
      hasOverflow ||= accumulator.overflowed;
      if (classification.type === 'asset') {
        const amounts = [...accumulator.balances];
        assets.push({ account, classification, amounts });
        for (let index = 0; index < dateCount; index += 1) {
          totalAssets[index] += amounts[index];
        }
      } else {
        // Section flip: liabilities and equity are credit-normal.
        const amounts = accumulator.balances.map(negateMinorUnits);
        const lines =
          classification.type === 'liability' ? liabilities : equity;
        lines.push({ account, classification, amounts });
        const totals =
          classification.type === 'liability' ? totalLiabilities : bookedEquity;
        for (let index = 0; index < dateCount; index += 1) {
          totals[index] += amounts[index];
        }
      }
    }

    // Presentation flip for the computed lines: cumulative profit is a net
    // credit (negative signed), shown positive in equity.
    const retainedEarnings = new Array<number>(dateCount).fill(0);
    const currentEarnings = new Array<number>(dateCount).fill(0);
    for (let index = 0; index < dateCount; index += 1) {
      if (dates[index].fiscalYearStart == null) {
        retainedEarnings[index] = negateMinorUnits(earningsAllTime[index]);
      } else {
        retainedEarnings[index] = negateMinorUnits(
          earningsBeforeFiscalYear[index]
        );
        currentEarnings[index] = negateMinorUnits(
          earningsAllTime[index] - earningsBeforeFiscalYear[index]
        );
      }
    }

    const totalEquity = bookedEquity.map(
      (value, index) => value + retainedEarnings[index] + currentEarnings[index]
    );
    const balancedByDate = totalAssets.map(
      (value, index) => value === totalLiabilities[index] + totalEquity[index]
    );
    for (const totals of [totalAssets, totalLiabilities, totalEquity]) {
      if (totals.some((value) => !Number.isSafeInteger(value))) {
        hasOverflow = true;
      }
    }

    sortByAccount(assets);
    sortByAccount(liabilities);
    sortByAccount(equity);
    sortByAccount(unclassified);
    sections.push({
      currency,
      assets,
      liabilities,
      equity,
      retainedEarnings,
      currentEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balancedByDate,
      unclassified,
      hasOverflow,
    });
  }

  return { dates, sections };
}

function sortByAccount(lines: Array<{ account: string }>): void {
  lines.sort((a, b) =>
    a.account < b.account ? -1 : a.account > b.account ? 1 : 0
  );
}
