// Income statement (P&L) derivation: period activity of income and expense
// accounts, one column per reporting period, one section per currency. A
// P&L line is the net movement of an account inside a period — cumulative
// balances never appear here; that is the balance sheet's job.
//
// Amounts are presentation-signed by section (income flipped so revenue
// reads positive; see StatementLine). Accounts the taxonomy cannot classify
// are surfaced in `unclassified` instead of guessed into a section, and
// balance-sheet-typed accounts simply do not report here.

import { negateMinorUnits } from './money';
import type {
  StatementLine,
  StatementPeriod,
  UnclassifiedBalance,
} from './statements';
import type { AccountTaxonomy } from './taxonomy';
import type { LedgerEntry, MinorUnits } from './types';

/** Options bag for {@link deriveIncomeStatement}. */
export interface IncomeStatementOptions {
  /** Reporting periods, one column each, in display order. At least one. */
  periods: readonly StatementPeriod[];
  /**
   * Classifies accounts into the income and expense sections. Without a
   * taxonomy every active account is unclassified and both sections are
   * empty — the statement never guesses.
   */
  taxonomy?: AccountTaxonomy;
}

/** One currency's income statement. */
export interface IncomeStatementSection {
  /** ISO 4217 or commodity code this section is denominated in. */
  currency: string;
  /** Income lines in account-path order, presentation-signed (revenue positive). */
  income: StatementLine[];
  /** Expense lines in account-path order, presentation-signed (costs positive). */
  expenses: StatementLine[];
  /** Sum of income lines per period. */
  totalIncome: readonly MinorUnits[];
  /** Sum of expense lines per period. */
  totalExpenses: readonly MinorUnits[];
  /** `totalIncome - totalExpenses` per period; positive means profit. */
  netIncome: readonly MinorUnits[];
  /** Active income-statement-period accounts the taxonomy could not place. */
  unclassified: UnclassifiedBalance[];
  /** True when any accumulation crossed 2^53; flagged, never repaired. */
  hasOverflow: boolean;
}

/** A derived income statement: one section per currency with P&L activity. */
export interface IncomeStatementData {
  /** The periods the columns report, in column order. */
  periods: readonly StatementPeriod[];
  /** Sections sorted by currency code. */
  sections: IncomeStatementSection[];
}

interface PeriodAccumulator {
  changes: number[];
  overflowed: boolean;
}

/**
 * Derives the income statement in one pass over the entries. Void entries
 * are excluded from meaning and unsafe posting amounts are skipped, matching
 * every other derivation. Only income- and expense-classified accounts (and
 * the unclassified residue with income-statement-relevant activity) report;
 * balance-sheet accounts are out of scope by definition, not by filter.
 */
export function deriveIncomeStatement(
  entries: readonly LedgerEntry[],
  options: IncomeStatementOptions
): IncomeStatementData {
  const { periods, taxonomy } = options;
  const periodCount = periods.length;

  // currency → account → per-period change accumulators.
  const byCurrency = new Map<string, Map<string, PeriodAccumulator>>();
  for (const entry of entries) {
    if (entry.flag === 'void') {
      continue;
    }
    // Precompute which columns this entry's date lands in; typical
    // statements carry a handful of periods, so a linear check per entry is
    // cheaper than anything clever.
    let matched: number[] | null = null;
    for (let index = 0; index < periodCount; index += 1) {
      const period = periods[index];
      if (entry.date >= period.dateFrom && entry.date <= period.dateTo) {
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
        accounts = new Map<string, PeriodAccumulator>();
        byCurrency.set(posting.currency, accounts);
      }
      let accumulator = accounts.get(posting.account);
      if (accumulator == null) {
        accumulator = {
          changes: new Array<number>(periodCount).fill(0),
          overflowed: false,
        };
        accounts.set(posting.account, accumulator);
      }
      for (const column of matched) {
        accumulator.changes[column] += posting.amount;
        if (!Number.isSafeInteger(accumulator.changes[column])) {
          accumulator.overflowed = true;
        }
      }
    }
  }

  const sections: IncomeStatementSection[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const accounts = byCurrency.get(currency) as Map<string, PeriodAccumulator>;
    const income: StatementLine[] = [];
    const expenses: StatementLine[] = [];
    const unclassified: UnclassifiedBalance[] = [];
    const totalIncome = new Array<number>(periodCount).fill(0);
    const totalExpenses = new Array<number>(periodCount).fill(0);
    let hasOverflow = false;

    for (const [account, accumulator] of accounts) {
      if (accumulator.changes.every((change) => change === 0)) {
        continue;
      }
      hasOverflow ||= accumulator.overflowed;
      const classification = taxonomy?.classify(account) ?? null;
      if (classification == null) {
        unclassified.push({ account, amounts: [...accumulator.changes] });
        continue;
      }
      if (classification.statement !== 'income-statement') {
        continue;
      }
      if (classification.type === 'income') {
        // Section flip: income is credit-normal, so revenue reads positive
        // and contra income (sales returns) reads negative.
        const amounts = accumulator.changes.map(negateMinorUnits);
        income.push({ account, classification, amounts });
        for (let index = 0; index < periodCount; index += 1) {
          totalIncome[index] += amounts[index];
        }
      } else {
        const amounts = [...accumulator.changes];
        expenses.push({ account, classification, amounts });
        for (let index = 0; index < periodCount; index += 1) {
          totalExpenses[index] += amounts[index];
        }
      }
    }

    const netIncome = totalIncome.map(
      (value, index) => value - totalExpenses[index]
    );
    for (const totals of [totalIncome, totalExpenses, netIncome]) {
      if (totals.some((value) => !Number.isSafeInteger(value))) {
        hasOverflow = true;
      }
    }

    sortByAccount(income);
    sortByAccount(expenses);
    sortByAccount(unclassified);
    sections.push({
      currency,
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netIncome,
      unclassified,
      hasOverflow,
    });
  }

  return { periods, sections };
}

function sortByAccount(lines: Array<{ account: string }>): void {
  lines.sort((a, b) =>
    a.account < b.account ? -1 : a.account > b.account ? 1 : 0
  );
}
