import type {
  BookPostingRef,
  LedgerEntry,
  MinorUnits,
  StatementLine,
} from '@cynco/journals';

// Handcrafted July reconciliation fixture for the home demo: five exact
// matches, one date-shifted suggestion (+2d), one statement-only bank fee,
// and one outstanding cheque on the book side. Integer sen throughout.

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
    id: 'l1',
    date: '2026-07-01',
    description: 'ACME SDN BHD TRF',
    amount: 450_000,
    currency: 'MYR',
  },
  {
    id: 'l2',
    date: '2026-07-03',
    description: 'TNB IBG PAYMENT',
    amount: -28_450,
    currency: 'MYR',
  },
  {
    id: 'l3',
    date: '2026-07-10',
    description: 'CHQ 001231 RENT',
    amount: -320_000,
    currency: 'MYR',
  },
  {
    id: 'l4',
    date: '2026-07-14',
    description: 'INITECH RETAINER',
    amount: 250_000,
    currency: 'MYR',
  },
  {
    id: 'l5',
    date: '2026-07-24',
    description: 'PAYROLL BATCH',
    amount: -764_000,
    currency: 'MYR',
  },
  {
    id: 'l6',
    date: '2026-07-28',
    description: 'VANDELAY EXPORT',
    amount: 133_700,
    currency: 'MYR',
  },
  {
    id: 'l7',
    date: '2026-07-31',
    description: 'BANK SERVICE FEE',
    amount: -1_500,
    currency: 'MYR',
  },
];

export const RECONCILIATION_POSTINGS: readonly BookPostingRef[] = [
  makeBookEntry({
    entryId: 'b1',
    date: '2026-07-01',
    payee: 'Acme Sdn Bhd',
    amount: 450_000,
    counterAccount: 'Income:Sales:Services-Consulting',
  }),
  makeBookEntry({
    entryId: 'b2',
    date: '2026-07-03',
    payee: 'Tenaga Nasional',
    amount: -28_450,
    counterAccount: 'Expenses:Utilities:Electricity',
  }),
  // Booked two days after the statement cleared the cheque: a suggestion.
  makeBookEntry({
    entryId: 'b3',
    date: '2026-07-12',
    payee: 'Landlord — cheque 001231',
    amount: -320_000,
    counterAccount: 'Expenses:Office:Rent',
  }),
  makeBookEntry({
    entryId: 'b4',
    date: '2026-07-14',
    payee: 'Initech Holdings',
    amount: 250_000,
    counterAccount: 'Income:Sales:Retainers',
  }),
  makeBookEntry({
    entryId: 'b5',
    date: '2026-07-24',
    payee: 'July payroll',
    amount: -764_000,
    counterAccount: 'Expenses:Payroll:Salaries',
  }),
  makeBookEntry({
    entryId: 'b6',
    date: '2026-07-28',
    payee: 'Vandelay Industries',
    amount: 133_700,
    counterAccount: 'Income:Sales:Export',
  }),
  // Outstanding cheque: in the books, not yet on the statement.
  makeBookEntry({
    entryId: 'b7',
    date: '2026-07-30',
    payee: 'MAIK Insurance — cheque 001232',
    amount: -55_000,
    counterAccount: 'Expenses:Insurance:General',
  }),
];
