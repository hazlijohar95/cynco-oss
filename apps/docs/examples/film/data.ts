// The ledger the film narrates: one real Malaysian payroll run, in integer
// minor units (sen) exactly as the engine stores it. Nothing here is a float
// — the film's whole point is that the numbers are the data.

export interface FilmPosting {
  account: string;
  /** Signed integer minor units (sen). Positive = debit, negative = credit. */
  amount: number;
}

export const FILM_CURRENCY = 'MYR';

// A payroll entry that balances to exactly zero: gross salary debited, then
// EPF / SOCSO / PCB withholdings and net pay credited out.
export const FILM_POSTINGS: readonly FilmPosting[] = [
  { account: 'Expenses:Payroll:Salaries', amount: 850_000 },
  { account: 'Liabilities:EPF-Payable', amount: -102_000 },
  { account: 'Liabilities:SOCSO-Payable', amount: -14_750 },
  { account: 'Liabilities:PCB-Payable', amount: -68_500 },
  { account: 'Assets:Current:Cash-Maybank', amount: -664_750 },
];

// The chart-of-accounts roll-up the postings feed, nearest-root first. Each
// node's rolled balance is the sum of its own and descendant postings — the
// same single-pass roll-up the AccountStore performs.
export interface FilmTreeRow {
  path: string;
  label: string;
  depth: number;
  /** Rolled balance in sen; sign follows the posting convention. */
  rolled: number;
  kind: 'group' | 'leaf';
}

export const FILM_TREE: readonly FilmTreeRow[] = [
  {
    path: 'Assets',
    label: 'Assets',
    depth: 0,
    rolled: -664_750,
    kind: 'group',
  },
  {
    path: 'Assets:Current:Cash-Maybank',
    label: 'Cash-Maybank',
    depth: 1,
    rolled: -664_750,
    kind: 'leaf',
  },
  {
    path: 'Liabilities',
    label: 'Liabilities',
    depth: 0,
    rolled: -185_250,
    kind: 'group',
  },
  {
    path: 'Liabilities:EPF-Payable',
    label: 'EPF-Payable',
    depth: 1,
    rolled: -102_000,
    kind: 'leaf',
  },
  {
    path: 'Liabilities:SOCSO-Payable',
    label: 'SOCSO-Payable',
    depth: 1,
    rolled: -14_750,
    kind: 'leaf',
  },
  {
    path: 'Liabilities:PCB-Payable',
    label: 'PCB-Payable',
    depth: 1,
    rolled: -68_500,
    kind: 'leaf',
  },
  {
    path: 'Expenses',
    label: 'Expenses',
    depth: 0,
    rolled: 850_000,
    kind: 'group',
  },
  {
    path: 'Expenses:Payroll:Salaries',
    label: 'Salaries',
    depth: 1,
    rolled: 850_000,
    kind: 'leaf',
  },
];

// Formats integer minor units as a fixed-decimal amount string. Pure integer
// math: divide and mod by 100, never parseFloat, so the displayed number is
// exactly the stored value. Negative amounts render with a leading minus.
export function formatMinorUnits(amount: number): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;
  const majorGrouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const minorPadded = minor.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${majorGrouped}.${minorPadded}`;
}
