import type {
  BookPostingRef,
  LedgerEntry,
  MinorUnits,
  StatementLine,
} from '@cynco/journals';

// Handcrafted July bank-reconciliation fixture: a statement page against
// the cash book with several exact matches, two date-shifted suggestions
// (±2d), one statement-only line (bank fee never journalled), and one
// book-only posting (an outstanding cheque). Amounts are exact integer sen.

export const RECONCILIATION_ACCOUNT = 'Assets:Current:Cash-Maybank';
export const RECONCILIATION_PERIOD = 'Jul 2026';

interface BookSeed {
  entryId: string;
  date: string;
  payee: string;
  amount: MinorUnits;
  counterAccount: string;
}

function makeBookEntry(seed: BookSeed): BookPostingRef {
  const entry: LedgerEntry = {
    id: seed.entryId,
    date: seed.date,
    flag: 'cleared',
    payee: seed.payee,
    narration: '',
    tags: [],
    links: [],
    postings: [
      {
        account: RECONCILIATION_ACCOUNT,
        amount: seed.amount,
        currency: 'MYR',
      },
      {
        account: seed.counterAccount,
        amount: -seed.amount,
        currency: 'MYR',
      },
    ],
  };
  return { entry, postingIndex: 0 };
}

export const RECONCILIATION_STATEMENT_LINES: readonly StatementLine[] = [
  {
    id: 'l01',
    date: '2026-07-01',
    description: 'ACME SDN BHD TRF',
    amount: 450_000,
    currency: 'MYR',
  },
  {
    id: 'l02',
    date: '2026-07-03',
    description: 'TNB IBG PAYMENT',
    amount: -28_450,
    currency: 'MYR',
  },
  {
    id: 'l03',
    date: '2026-07-05',
    description: 'GLOBEX INV 2107',
    amount: 182_500,
    currency: 'MYR',
  },
  {
    id: 'l04',
    date: '2026-07-08',
    description: 'UNIFI AUTOPAY',
    amount: -12_900,
    currency: 'MYR',
  },
  {
    id: 'l05',
    date: '2026-07-10',
    description: 'CHQ 001231 RENT',
    amount: -320_000,
    currency: 'MYR',
  },
  {
    id: 'l06',
    date: '2026-07-14',
    description: 'INITECH RETAINER',
    amount: 250_000,
    currency: 'MYR',
  },
  {
    id: 'l07',
    date: '2026-07-16',
    description: 'SHELL FLEET CARD',
    amount: -41_237,
    currency: 'MYR',
  },
  {
    id: 'l08',
    date: '2026-07-18',
    description: 'STAPLES OFFICE',
    amount: -8_646,
    currency: 'MYR',
  },
  {
    id: 'l09',
    date: '2026-07-21',
    description: 'HOOLI LICENSING',
    amount: 96_000,
    currency: 'MYR',
  },
  {
    id: 'l10',
    date: '2026-07-24',
    description: 'PAYROLL BATCH',
    amount: -764_000,
    currency: 'MYR',
  },
  {
    id: 'l11',
    date: '2026-07-28',
    description: 'VANDELAY EXPORT',
    amount: 133_700,
    currency: 'MYR',
  },
  {
    id: 'l12',
    date: '2026-07-31',
    description: 'BANK SERVICE FEE',
    amount: -1_500,
    currency: 'MYR',
  },
];

export const RECONCILIATION_POSTINGS: readonly BookPostingRef[] = [
  // Exact matches (same date, same amount).
  makeBookEntry({
    entryId: 'b01',
    date: '2026-07-01',
    payee: 'Acme Sdn Bhd',
    amount: 450_000,
    counterAccount: 'Income:Sales:Services-Consulting',
  }),
  makeBookEntry({
    entryId: 'b02',
    date: '2026-07-03',
    payee: 'Tenaga Nasional',
    amount: -28_450,
    counterAccount: 'Expenses:Utilities:Electricity',
  }),
  makeBookEntry({
    entryId: 'b03',
    date: '2026-07-05',
    payee: 'Globex Corporation',
    amount: 182_500,
    counterAccount: 'Assets:Current:AR',
  }),
  makeBookEntry({
    entryId: 'b04',
    date: '2026-07-08',
    payee: 'TM Unifi',
    amount: -12_900,
    counterAccount: 'Expenses:Utilities:Internet',
  }),
  makeBookEntry({
    entryId: 'b06',
    date: '2026-07-14',
    payee: 'Initech Holdings',
    amount: 250_000,
    counterAccount: 'Income:Sales:Retainers',
  }),
  makeBookEntry({
    entryId: 'b08',
    date: '2026-07-18',
    payee: 'Staples Malaysia',
    amount: -8_646,
    counterAccount: 'Expenses:Office:Supplies',
  }),
  makeBookEntry({
    entryId: 'b09',
    date: '2026-07-21',
    payee: 'Hooli Licensing',
    amount: 96_000,
    counterAccount: 'Income:Sales:Licensing',
  }),
  makeBookEntry({
    entryId: 'b10',
    date: '2026-07-24',
    payee: 'July payroll',
    amount: -764_000,
    counterAccount: 'Expenses:Payroll:Salaries',
  }),
  makeBookEntry({
    entryId: 'b11',
    date: '2026-07-28',
    payee: 'Vandelay Industries',
    amount: 133_700,
    counterAccount: 'Income:Sales:Export',
  }),
  // Suggested matches: booked 2 days away from the statement date.
  makeBookEntry({
    entryId: 'b07',
    date: '2026-07-14',
    payee: 'Shell fleet card',
    amount: -41_237,
    counterAccount: 'Expenses:Vehicle:Fuel',
  }),
  makeBookEntry({
    entryId: 'b05',
    date: '2026-07-12',
    payee: 'Landlord — cheque 001231',
    amount: -320_000,
    counterAccount: 'Expenses:Office:Rent',
  }),
  // Outstanding cheque: in the books, not yet on the statement.
  makeBookEntry({
    entryId: 'b12',
    date: '2026-07-30',
    payee: 'MAIK Insurance — cheque 001232',
    amount: -55_000,
    counterAccount: 'Expenses:Insurance:General',
  }),
];
