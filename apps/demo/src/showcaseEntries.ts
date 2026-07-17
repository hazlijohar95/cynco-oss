import type { LedgerEntry } from '@cynco/journals';

/** One gallery card: an entry plus the copy describing what it exercises. */
export interface ShowcaseEntry {
  entry: LedgerEntry;
  /** Card title shown above the rendered entry. */
  title: string;
  /** One-line description of the primitive/state the card demonstrates. */
  note: string;
  /** Renders the 1-based posting number gutter on this card. */
  showLineNumbers?: boolean;
  /** Posting index to attach a demo annotation slot to. */
  annotatePostingIndex?: number;
  /** Text content of the demo annotation. */
  annotationText?: string;
}

// Handcrafted entries covering every JournalEntry rendering path: balanced
// and unbalanced amounts, all four lifecycle flags, tags/links, and true
// multi-currency postings. All amounts are exact integer minor units (sen /
// cents) and every entry except the deliberate one balances per currency.
export const SHOWCASE_ENTRIES: readonly ShowcaseEntry[] = [
  {
    title: 'Simple sale',
    note: 'The minimal two-posting entry: cash debit against consulting income.',
    entry: {
      id: 'demo-sale',
      date: '2026-07-01',
      flag: 'cleared',
      payee: 'Delima Trading',
      narration: 'Invoice for goods delivered',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 125_000,
          currency: 'MYR',
        },
        {
          account: 'Income:Sales:Services-Consulting',
          amount: -125_000,
          currency: 'MYR',
        },
      ],
    },
  },
  {
    title: 'Payroll run (EPF / SOCSO splits)',
    note: 'Six postings with statutory splits, rendered with the posting number gutter.',
    showLineNumbers: true,
    entry: {
      id: 'demo-payroll',
      date: '2026-07-25',
      flag: 'cleared',
      payee: null,
      narration: 'July payroll run',
      tags: ['payroll'],
      links: [],
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
    },
  },
  {
    title: 'Multi-currency export',
    note: 'USD legs and MYR bank-fee legs balance independently per currency; the USD income posting carries an annotation slot.',
    annotatePostingIndex: 1,
    annotationText:
      'FX memo: settled at 4.4210 MYR/USD on 2026-07-09 (Wise batch W-2214).',
    entry: {
      id: 'demo-export',
      date: '2026-07-08',
      flag: 'cleared',
      payee: 'Acme Corp (Singapore)',
      narration: 'Export sales invoice',
      tags: ['export'],
      links: ['inv-8823'],
      postings: [
        {
          account: 'Assets:Current:Cash-Wise',
          amount: 120_000,
          currency: 'USD',
        },
        {
          account: 'Income:Sales:Products-Export',
          amount: -120_000,
          currency: 'USD',
        },
        {
          account: 'Expenses:Bank:Charges',
          amount: 1_500,
          currency: 'MYR',
        },
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: -1_500,
          currency: 'MYR',
        },
      ],
    },
  },
  {
    title: 'Unbalanced entry',
    note: 'Deliberately off by +4.25 MYR: the checker bar renders the imbalance instead of silently repairing it.',
    entry: {
      id: 'demo-unbalanced',
      date: '2026-07-11',
      flag: 'flagged',
      payee: 'Popular Book Store',
      narration:
        'Stationery purchase, receipt total does not match card charge',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Expenses:Office:Stationery',
          amount: 8_425,
          currency: 'MYR',
        },
        {
          account: 'Assets:Current:Cash-CIMB',
          amount: -8_000,
          currency: 'MYR',
        },
      ],
    },
  },
  {
    title: 'Tags and links',
    note: 'Recurring rent carrying #tags and a ^link back to the invoice document.',
    entry: {
      id: 'demo-tagged',
      date: '2026-07-01',
      flag: 'cleared',
      payee: 'Hartanah Prima Sdn Bhd',
      narration: 'Office rent, July',
      tags: ['recurring', 'audit'],
      links: ['inv-2026-0714'],
      postings: [
        {
          account: 'Expenses:Rent:Office',
          amount: 350_000,
          currency: 'MYR',
        },
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: -350_000,
          currency: 'MYR',
        },
      ],
    },
  },
  {
    title: 'Pending entry',
    note: 'Recorded but not yet reconciled: the pending flag dot changes color.',
    entry: {
      id: 'demo-pending',
      date: '2026-07-15',
      flag: 'pending',
      payee: 'Maybank',
      narration: 'Credit card settlement, awaiting statement',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Liabilities:Current:CreditCard-Maybank',
          amount: 240_050,
          currency: 'MYR',
        },
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: -240_050,
          currency: 'MYR',
        },
      ],
    },
  },
  {
    title: 'Flagged for review',
    note: 'Balanced but parked in suspense until the deposit is identified.',
    entry: {
      id: 'demo-flagged',
      date: '2026-07-17',
      flag: 'flagged',
      payee: null,
      narration: 'Unidentified deposit under review',
      tags: ['suspense'],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 50_000,
          currency: 'MYR',
        },
        {
          account: 'Assets:Current:Suspense',
          amount: -50_000,
          currency: 'MYR',
        },
      ],
    },
  },
];
