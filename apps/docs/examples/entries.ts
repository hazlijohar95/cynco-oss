import type { LedgerEntry } from '@cynco/journals';

/**
 * Instance id shared by the home account-tree demo's server preload and the
 * client hook, so hydrated row ids line up. Lives here (a shared module, not
 * the 'use client' demo file) because string exports of client modules reach
 * server components as client-reference proxies, not values.
 */
export const ACCOUNT_TREE_DEMO_ID = 'home-accounts';

/**
 * Workspace hero tree: instance id and the controller options mirrored
 * between `preloadAccountTreeHTML` and the client hook. Shared from this
 * plain module (not the 'use client' demo file) for the same
 * client-reference-proxy reason as above.
 */
export const WORKSPACE_TREE_ID = 'workspace-tree';

export const WORKSPACE_TREE_OPTIONS = {
  currency: 'MYR',
  density: 'compact',
  initialExpansion: 'all',
} as const;

// Handcrafted entries for the home-page demos. All amounts are exact integer
// minor units (sen); every entry except the deliberate imbalance balances
// per currency.

/** July payroll run with statutory EPF/SOCSO splits across six postings. */
export const PAYROLL_ENTRY: LedgerEntry = {
  id: 'home-payroll',
  date: '2026-07-25',
  flag: 'cleared',
  payee: null,
  narration: 'July payroll run',
  tags: ['payroll'],
  links: ['PR-2026-07'],
  postings: [
    {
      account: 'Expenses:Payroll:Salaries',
      amount: 800_000,
      currency: 'MYR',
    },
    {
      account: 'Expenses:Payroll:EPF',
      amount: 104_000,
      currency: 'MYR',
    },
    {
      account: 'Expenses:Payroll:SOCSO',
      amount: 13_860,
      currency: 'MYR',
    },
    {
      account: 'Liabilities:Current:EPF-Payable',
      amount: -192_000,
      currency: 'MYR',
    },
    {
      account: 'Liabilities:Current:SOCSO-Payable',
      amount: -17_860,
      currency: 'MYR',
    },
    {
      account: 'Assets:Current:Cash-Maybank',
      amount: -708_000,
      currency: 'MYR',
    },
  ],
};

/**
 * Deliberately unbalanced: the cash leg is RM 1.00 short, so the renderer
 * draws the dashed checker bar and reports the exact per-currency residual.
 */
export const UNBALANCED_ENTRY: LedgerEntry = {
  id: 'home-unbalanced',
  date: '2026-07-14',
  flag: 'flagged',
  payee: 'Delima Trading',
  narration: 'Invoice for goods delivered — cash leg keyed short',
  tags: [],
  links: [],
  postings: [
    {
      account: 'Assets:Current:Cash-Maybank',
      amount: 124_900,
      currency: 'MYR',
    },
    {
      account: 'Income:Sales:Services-Consulting',
      amount: -125_000,
      currency: 'MYR',
    },
  ],
};
