import type {
  AccountTaxonomy,
  LedgerEntry,
  StatementDate,
  StatementPeriod,
} from '@cynco/statements';
import {
  createAccountTaxonomy,
  createOpeningBalanceEntry,
} from '@cynco/statements';

// Handcrafted ledger for the statements docs demos: a small Malaysian
// consultancy across two financial years (FY2025 + FY2026). All amounts are
// exact integer minor units (sen); every entry balances per currency — the
// opening entry by construction (createOpeningBalanceEntry books the equity
// offset), the rest as hand-checked two-posting pairs. Two deliberate
// features ride along: `Suspense:Pending-Query` stays outside the taxonomy
// so the flagged unclassified rendering is visible, and
// `Assets:Fixed:Accumulated-Depreciation` carries a contra override so the
// credit-normal asset renders without an abnormal flag.

/**
 * Day-one position, migrated as an ordinary balanced entry: each
 * carried-forward balance posts against `Equity:Opening-Balances`, so the
 * ledger starts balanced by construction rather than by assertion.
 */
const OPENING_ENTRY: LedgerEntry = createOpeningBalanceEntry({
  id: 'stmt-opening',
  date: '2025-01-01',
  lines: [
    {
      account: 'Assets:Current:Cash-Maybank',
      amount: 5_000_000,
      currency: 'MYR',
    },
    {
      account: 'Assets:Fixed:Office-Equipment',
      amount: 1_200_000,
      currency: 'MYR',
    },
    {
      account: 'Assets:Fixed:Accumulated-Depreciation',
      amount: -300_000,
      currency: 'MYR',
    },
    {
      account: 'Liabilities:Current:SST-Payable',
      amount: -80_000,
      currency: 'MYR',
    },
  ],
});

// A two-posting entry balances exactly when the amounts are equal and
// opposite; every operating entry below follows that shape so the whole
// fixture is checkable by eye.
function operatingEntry(
  id: string,
  date: string,
  narration: string,
  debitAccount: string,
  creditAccount: string,
  amount: number,
  tags: readonly string[] = []
): LedgerEntry {
  return {
    id,
    date,
    flag: 'cleared',
    payee: null,
    narration,
    tags,
    links: [],
    postings: [
      { account: debitAccount, amount, currency: 'MYR' },
      { account: creditAccount, amount: -amount, currency: 'MYR' },
    ],
  };
}

/** The full fixture ledger, in date order. */
export const STATEMENT_ENTRIES: readonly LedgerEntry[] = [
  OPENING_ENTRY,
  operatingEntry(
    'stmt-2025-consulting-1',
    '2025-02-10',
    'Consulting engagement — paid on delivery',
    'Assets:Current:Cash-Maybank',
    'Income:Sales:Services-Consulting',
    1_200_000
  ),
  operatingEntry(
    'stmt-2025-rent',
    '2025-03-01',
    'Office rent — 2025',
    'Expenses:Rent:Office',
    'Assets:Current:Cash-Maybank',
    240_000
  ),
  operatingEntry(
    'stmt-2025-consulting-2',
    '2025-05-18',
    'Consulting engagement — invoiced on credit',
    'Assets:Current:AR',
    'Income:Sales:Services-Consulting',
    950_000
  ),
  operatingEntry(
    'stmt-2025-ar-collected',
    '2025-07-02',
    'Receivable collected',
    'Assets:Current:Cash-Maybank',
    'Assets:Current:AR',
    950_000
  ),
  operatingEntry(
    'stmt-2025-sst-remitted',
    '2025-09-30',
    'SST remitted to Customs',
    'Liabilities:Current:SST-Payable',
    'Assets:Current:Cash-Maybank',
    80_000
  ),
  operatingEntry(
    'stmt-2025-suspense',
    '2025-11-14',
    'Unidentified bank credit — parked pending query',
    'Assets:Current:Cash-Maybank',
    'Suspense:Pending-Query',
    50_000
  ),
  operatingEntry(
    'stmt-2025-depreciation',
    '2025-12-31',
    'Depreciation — office equipment FY2025',
    'Expenses:Depreciation:Office-Equipment',
    'Assets:Fixed:Accumulated-Depreciation',
    120_000,
    ['adjustment']
  ),
  operatingEntry(
    'stmt-2026-retainer',
    '2026-01-15',
    'Annual retainer received',
    'Assets:Current:Cash-Maybank',
    'Income:Sales:Services-Consulting',
    1_500_000
  ),
  operatingEntry(
    'stmt-2026-rent',
    '2026-02-01',
    'Office rent — 2026',
    'Expenses:Rent:Office',
    'Assets:Current:Cash-Maybank',
    240_000
  ),
  operatingEntry(
    'stmt-2026-salaries',
    '2026-04-05',
    'Contract staff salaries',
    'Expenses:Payroll:Salaries',
    'Assets:Current:Cash-Maybank',
    600_000
  ),
  operatingEntry(
    'stmt-2026-consulting',
    '2026-09-12',
    'Consulting engagement — paid on delivery',
    'Assets:Current:Cash-Maybank',
    'Income:Sales:Services-Consulting',
    800_000
  ),
  operatingEntry(
    'stmt-2026-depreciation',
    '2026-12-31',
    'Depreciation — office equipment FY2026',
    'Expenses:Depreciation:Office-Equipment',
    'Assets:Fixed:Accumulated-Depreciation',
    120_000,
    ['adjustment']
  ),
];

/**
 * The demos' shared classification oracle: the default five-root convention
 * plus one contra override. `Suspense:Pending-Query` deliberately has no
 * override, so it classifies to null and every statement flags it instead of
 * guessing it into a section.
 */
export const STATEMENT_TAXONOMY: AccountTaxonomy = createAccountTaxonomy({
  overrides: {
    // Accumulated depreciation is an asset with a credit normal balance;
    // without the override every credit balance here would flag abnormal.
    'Assets:Fixed:Accumulated-Depreciation': { contra: true },
  },
});

/** As-of bound for the trial balance demo: end of the latest fixture year. */
export const TRIAL_BALANCE_AS_OF = '2026-12-31';

/** Two comparative financial years for the income statement columns. */
export const INCOME_STATEMENT_PERIODS: readonly StatementPeriod[] = [
  { label: 'FY2025', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
  { label: 'FY2026', dateFrom: '2026-01-01', dateTo: '2026-12-31' },
];

/**
 * Two comparative year-end dates for the balance sheet columns. Each carries
 * its fiscal-year start so the virtual closing splits into retained earnings
 * (prior years) and current-year earnings (inside the column's year).
 */
export const BALANCE_SHEET_DATES: readonly StatementDate[] = [
  { label: '31 Dec 2025', asOf: '2025-12-31', fiscalYearStart: '2025-01-01' },
  { label: '31 Dec 2026', asOf: '2026-12-31', fiscalYearStart: '2026-01-01' },
];
