// Trial balance derivation: every account with direct postings, its signed
// closing balance split into the conventional debit/credit columns, one
// section per currency (mixing currencies in one column would be a lie the
// suite refuses to tell — cross-currency translation is an explicit, separate
// feature). One linear pass over the entries; report-time cost, no register
// index rebuilds.

import { matchesEntryFilter } from './entryFilter';
import type { AccountClassification, AccountTaxonomy } from './taxonomy';
import type { EntryFilter, LedgerEntry, MinorUnits } from './types';

/** Options bag for {@link deriveTrialBalance}. */
export interface TrialBalanceOptions {
  /**
   * Inclusive ISO date the balances report through. Omitted means every
   * entry contributes — the all-time trial balance.
   */
  asOf?: string;
  /**
   * Classifies rows (type, normal balance) and orders them in statement
   * convention. Without a taxonomy every row is unclassified and rows sort
   * by account path alone.
   */
  taxonomy?: AccountTaxonomy;
  /**
   * Working-trial-balance mode: entries matching this filter count as
   * adjustments, and every row splits into unadjusted / adjustment /
   * adjusted columns. The conventional setup tags adjusting entries
   * `adjustment` and passes `{ tag: 'adjustment' }`.
   */
  adjustments?: EntryFilter;
  /**
   * Zero-activity accounts to include with zero balances (the full chart of
   * accounts, not just accounts that saw postings). Included in every
   * currency section. Invalid or duplicate paths are ignored.
   */
  accountPaths?: readonly string[];
}

/** One account row of a trial balance section. */
export interface TrialBalanceRow {
  /** Canonical colon-delimited account path. */
  account: string;
  /** Taxonomy classification, or null when unclassified (flag, not guess). */
  classification: AccountClassification | null;
  /**
   * Signed closing balance (adjusted, when adjustments are in play):
   * positive sits in the debit column, negative in the credit column.
   */
  balance: MinorUnits;
  /** Signed balance excluding adjustment entries; null without adjustments. */
  unadjusted: MinorUnits | null;
  /** Signed net of adjustment entries alone; null without adjustments. */
  adjustment: MinorUnits | null;
  /**
   * True when the account holds the opposite of its normal balance (an
   * asset in credit, income in debit) — the classic review flag on a trial
   * balance. Always false for zero balances and unclassified rows.
   */
  abnormal: boolean;
}

/** One currency's trial balance. */
export interface TrialBalanceSection {
  /** ISO 4217 or commodity code this section is denominated in. */
  currency: string;
  /** Rows in statement order: assets, liabilities, equity, income, expenses, unclassified; by path within a group. */
  rows: TrialBalanceRow[];
  /** Sum of debit-column balances (non-negative magnitude). */
  totalDebit: MinorUnits;
  /** Sum of credit-column balances (non-negative magnitude). */
  totalCredit: MinorUnits;
  /**
   * The proof line: true exactly when totalDebit equals totalCredit.
   * Computed, never asserted — an out-of-balance ledger renders honestly.
   */
  balanced: boolean;
  /**
   * True when any per-account running total crossed 2^53 during
   * accumulation; affected balances are no longer exact and must be treated
   * as flagged, not authoritative.
   */
  hasOverflow: boolean;
}

/** A derived trial balance: one section per currency touched. */
export interface TrialBalanceData {
  /** The as-of bound the balances honor, or null for all-time. */
  asOf: string | null;
  /** Sections sorted by currency code. */
  sections: TrialBalanceSection[];
}

// Statement-conventional group order for rows; unclassified rows sort last
// so the flagged residue is always visible at the bottom of the section.
const TYPE_ORDER: Readonly<Record<string, number>> = {
  asset: 0,
  liability: 1,
  equity: 2,
  income: 3,
  expense: 4,
};

interface Accumulator {
  total: number;
  adjustment: number;
  overflowed: boolean;
}

/**
 * Derives the trial balance of a ledger in one pass. Void entries are
 * excluded from meaning; postings with unsafe (non-integer) amounts are
 * skipped, matching `sumPostingsByCurrency`; aggregate overflow past 2^53 is
 * flagged on the section, never silently absorbed. Rows appear for every
 * (account, currency) with a nonzero column, plus every `accountPaths`
 * account at zero in every section.
 */
export function deriveTrialBalance(
  entries: readonly LedgerEntry[],
  options: TrialBalanceOptions = {}
): TrialBalanceData {
  const { asOf, taxonomy, adjustments } = options;

  // currency → account → accumulator, built in one entry scan.
  const byCurrency = new Map<string, Map<string, Accumulator>>();
  for (const entry of entries) {
    if (entry.flag === 'void') {
      continue;
    }
    if (asOf != null && entry.date > asOf) {
      continue;
    }
    const isAdjustment =
      adjustments != null && matchesEntryFilter(entry, adjustments);
    for (const posting of entry.postings) {
      if (!Number.isSafeInteger(posting.amount)) {
        continue;
      }
      let accounts = byCurrency.get(posting.currency);
      if (accounts == null) {
        accounts = new Map<string, Accumulator>();
        byCurrency.set(posting.currency, accounts);
      }
      let accumulator = accounts.get(posting.account);
      if (accumulator == null) {
        accumulator = { total: 0, adjustment: 0, overflowed: false };
        accounts.set(posting.account, accumulator);
      }
      accumulator.total += posting.amount;
      if (isAdjustment) {
        accumulator.adjustment += posting.amount;
      }
      if (
        !Number.isSafeInteger(accumulator.total) ||
        !Number.isSafeInteger(accumulator.adjustment)
      ) {
        accumulator.overflowed = true;
      }
    }
  }

  const sections: TrialBalanceSection[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const accounts = byCurrency.get(currency) as Map<string, Accumulator>;
    // Zero-activity chart accounts appear in every section so a printed
    // trial balance shows the full chart, not just accounts with postings.
    if (options.accountPaths != null) {
      for (const path of options.accountPaths) {
        if (!accounts.has(path)) {
          accounts.set(path, { total: 0, adjustment: 0, overflowed: false });
        }
      }
    }

    const rows: TrialBalanceRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let hasOverflow = false;
    for (const [account, accumulator] of accounts) {
      const includeZeroRow = options.accountPaths?.includes(account) === true;
      if (
        accumulator.total === 0 &&
        accumulator.adjustment === 0 &&
        !includeZeroRow
      ) {
        continue;
      }
      hasOverflow ||= accumulator.overflowed;
      const classification = taxonomy?.classify(account) ?? null;
      const balance = accumulator.total;
      rows.push({
        account,
        classification,
        balance,
        unadjusted:
          adjustments == null ? null : balance - accumulator.adjustment,
        adjustment: adjustments == null ? null : accumulator.adjustment,
        abnormal:
          classification != null &&
          balance !== 0 &&
          (balance > 0 ? 'debit' : 'credit') !== classification.normalBalance,
      });
      if (balance > 0) {
        totalDebit += balance;
      } else {
        totalCredit += -balance;
      }
    }
    if (
      !Number.isSafeInteger(totalDebit) ||
      !Number.isSafeInteger(totalCredit)
    ) {
      hasOverflow = true;
    }

    rows.sort((a, b) => {
      const orderA =
        a.classification == null ? 5 : TYPE_ORDER[a.classification.type];
      const orderB =
        b.classification == null ? 5 : TYPE_ORDER[b.classification.type];
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
    });

    sections.push({
      currency,
      rows,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
      hasOverflow,
    });
  }

  return { asOf: asOf ?? null, sections };
}
