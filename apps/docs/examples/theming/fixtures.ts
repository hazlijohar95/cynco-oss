import type { LedgerEntry } from '@cynco/journals';

// Handcrafted four-posting sale for the CVD comparison: two debits against
// two credits, so both sides of the debit/credit color axis render in one
// compact card. Integer sen; balances to exactly zero.
export const CVD_SAMPLE_ENTRY: LedgerEntry = {
  id: 'theming-cvd-sample',
  date: '2026-07-18',
  flag: 'cleared',
  payee: 'Delima Trading',
  narration: 'Consulting invoice settled, net of agency commission',
  tags: [],
  links: [],
  postings: [
    {
      account: 'Assets:Current:Cash-Maybank',
      amount: 470_000,
      currency: 'MYR',
    },
    {
      account: 'Expenses:Professional:Commission',
      amount: 30_000,
      currency: 'MYR',
    },
    {
      account: 'Income:Sales:Services-Consulting',
      amount: -500_000,
      currency: 'MYR',
    },
  ],
};
