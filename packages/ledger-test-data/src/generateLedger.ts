// Deterministic ledger fixture generator. Given the same options, the
// output is byte-for-byte identical on every run and runtime — tests and
// benchmarks depend on that to compare projections and timings across
// machines. Every generated entry is balanced by construction (per-currency
// zero sum) and every amount is an exact integer in minor units.

import type { EntryFlag, LedgerEntry, Posting } from '@cynco/ledger-core';

import { createSeededRandom, type SeededRandom } from './seededRandom';

const DAY_MS = 86_400_000;

// Realistic Malaysian SME counterparties, grouped by scenario so payee and
// account choices stay coherent (TNB bills electricity, not consulting).
const SALE_PAYEES = [
  'Syarikat Maju Jaya Sdn Bhd',
  'Tech Ventures Sdn Bhd',
  'Delima Trading',
  'Pelanggan Setia Enterprise',
  'Nusantara Retail Sdn Bhd',
] as const;
const MARKETPLACE_PAYEES = ['Shopee', 'Lazada', 'TikTok Shop'] as const;
const EXPORT_PAYEES = [
  'Acme Corp (Singapore)',
  'Global Widgets Pte Ltd',
  'Pacific Imports LLC',
] as const;
const TRANSFER_PAYEES = ['Maybank', 'CIMB', 'Public Bank'] as const;

// Expense payees paired with the account they usually hit.
const EXPENSE_PROFILES: ReadonlyArray<{
  account: string;
  payees: readonly string[];
}> = [
  { account: 'Expenses:Utilities:Electricity-TNB', payees: ['TNB'] },
  { account: 'Expenses:Utilities:Internet-TM-Unifi', payees: ['TM Unifi'] },
  { account: 'Expenses:Utilities:Mobile-Maxis', payees: ['Maxis'] },
  { account: 'Expenses:Software:AWS', payees: ['AWS'] },
  { account: 'Expenses:Software:Google-Workspace', payees: ['Google'] },
  { account: 'Expenses:Travel:Grab', payees: ['Grab'] },
  {
    account: 'Expenses:Travel:Flights',
    payees: ['AirAsia', 'Malaysia Airlines'],
  },
  {
    account: 'Expenses:Office:Postage-Courier',
    payees: ['Pos Laju', 'J&T Express'],
  },
  { account: 'Expenses:Marketing:Ads-Google', payees: ['Google Ads'] },
  { account: 'Expenses:Marketing:Ads-Meta', payees: ['Meta'] },
  { account: 'Expenses:Rent:Office', payees: ['Hartanah Prima Sdn Bhd'] },
  {
    account: 'Expenses:Office:Stationery',
    payees: ['Popular Book Store', 'MR DIY'],
  },
  { account: 'Expenses:Vehicle:Fuel', payees: ['Petronas', 'Shell'] },
  {
    account: 'Expenses:Professional:Secretarial-Fee',
    payees: ['KL Corporate Services'],
  },
  { account: 'Expenses:Bank:Charges', payees: ['Maybank', 'CIMB'] },
] as const;

const CASH_ACCOUNTS = [
  'Assets:Current:Cash-Maybank',
  'Assets:Current:Cash-CIMB',
  'Assets:Current:Cash-PublicBank',
] as const;

const SALE_NARRATIONS = [
  'Invoice for goods delivered',
  'Monthly retainer billing',
  'Project milestone billing',
  'Sales order fulfilment',
] as const;
const EXPENSE_NARRATIONS = [
  'Monthly bill',
  'Subscription renewal',
  'Purchase for operations',
  'Service charge',
] as const;

const TAG_POOL = [
  'recurring',
  'reimbursable',
  'q1',
  'project-alpha',
  'audit',
] as const;

/** Options bag for {@link generateLedger}. */
export interface GenerateLedgerOptions {
  /** PRNG seed; same seed + options → identical output. */
  seed: number;
  /** Number of entries to generate. */
  entryCount: number;
  /** Inclusive ISO date lower bound for entry dates. */
  startDate: string;
  /** Inclusive ISO date upper bound for entry dates. */
  endDate: string;
  /**
   * Currency codes to draw from. The first is the home currency (used by
   * most entries); additional codes appear in occasional export sales and
   * multi-currency entries. Defaults to `['MYR', 'USD']`.
   */
  currencies?: readonly string[];
}

// Exact-integer percentage of an amount that is a multiple of 100 minor
// units: (amount / 100) is an exact integer, so no float rounding can leak
// into generated postings. Generated base amounts are always whole-ringgit
// multiples of 100 sen for this reason.
function exactPercentOfWhole(
  amountInMinorUnits: number,
  percent: number
): number {
  return (amountInMinorUnits / 100) * percent;
}

// Flags follow a realistic ledger distribution: mostly cleared, a working
// set of pending items, and rare flagged/void entries.
function pickFlag(random: SeededRandom): EntryFlag {
  const roll = random.next();
  if (roll < 0.9) {
    return 'cleared';
  }
  if (roll < 0.97) {
    return 'pending';
  }
  if (roll < 0.995) {
    return 'flagged';
  }
  return 'void';
}

function formatIsoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

// One generated transaction before ids are assigned (ids depend on the
// final date-sorted order).
interface DraftEntry {
  date: string;
  flag: EntryFlag;
  payee: string | null;
  narration: string;
  tags: readonly string[];
  links: readonly string[];
  postings: readonly Posting[];
}

/**
 * Generates a deterministic list of balanced ledger entries dated within
 * `[startDate, endDate]`, sorted by `(date, id)` with ids assigned in date
 * order (`e0000001`, ...). Scenarios mirror a Malaysian SME's activity:
 * credit sales with SST, marketplace settlements, supplier bills, payroll
 * runs with EPF splits, bank transfers, and (when more than one currency is
 * configured) export sales including occasional true multi-currency entries.
 */
export function generateLedger(options: GenerateLedgerOptions): LedgerEntry[] {
  const {
    seed,
    entryCount,
    startDate,
    endDate,
    currencies = ['MYR', 'USD'],
  } = options;
  const random = createSeededRandom(seed);
  const homeCurrency = currencies[0] ?? 'MYR';
  const foreignCurrencies = currencies.slice(1);

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const dayCount =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? Math.floor((endMs - startMs) / DAY_MS) + 1
      : 1;

  const drafts: DraftEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const date = formatIsoDate(startMs + random.nextInt(0, dayCount) * DAY_MS);
    const scenarioRoll = random.next();

    let payee: string | null;
    let narration: string;
    let postings: Posting[];

    if (scenarioRoll < 0.25) {
      // Credit sale with 8% SST: AR carries the gross, income and SST split it.
      const net = random.nextInt(5, 500) * 100;
      const sst = exactPercentOfWhole(net, 8);
      payee = random.pick(SALE_PAYEES);
      narration = random.pick(SALE_NARRATIONS);
      postings = [
        {
          account: 'Assets:Current:AR',
          amount: net + sst,
          currency: homeCurrency,
        },
        {
          account: 'Income:Sales:Services-Consulting',
          amount: -net,
          currency: homeCurrency,
        },
        {
          account: 'Liabilities:Current:SST-Payable',
          amount: -sst,
          currency: homeCurrency,
        },
      ];
    } else if (scenarioRoll < 0.35) {
      // Marketplace settlement: cash in net of platform commission.
      const gross = random.nextInt(3, 300) * 100;
      const commission = exactPercentOfWhole(gross, 12);
      payee = random.pick(MARKETPLACE_PAYEES);
      narration = 'Marketplace settlement payout';
      postings = [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: gross - commission,
          currency: homeCurrency,
        },
        {
          account: 'Income:Sales:Marketplace-Commissions',
          amount: commission,
          currency: homeCurrency,
        },
        {
          account: `Income:Sales:${payee === 'Shopee' ? 'Shopee' : payee === 'Lazada' ? 'Lazada' : 'TikTok-Shop'}`,
          amount: -gross,
          currency: homeCurrency,
        },
      ];
    } else if (scenarioRoll < 0.75) {
      // Supplier bill paid from cash or card.
      const amount = random.nextInt(1, 800) * 100;
      const profile = random.pick(EXPENSE_PROFILES);
      const settlement =
        random.next() < 0.7
          ? random.pick(CASH_ACCOUNTS)
          : 'Liabilities:Current:CreditCard-Maybank';
      payee = random.pick(profile.payees);
      narration = random.pick(EXPENSE_NARRATIONS);
      postings = [
        { account: profile.account, amount, currency: homeCurrency },
        { account: settlement, amount: -amount, currency: homeCurrency },
      ];
    } else if (scenarioRoll < 0.8) {
      // Payroll run: gross salary plus employer EPF, offset by the EPF
      // liability (employee 11% + employer 13%) and net cash out.
      const gross = random.nextInt(30, 150) * 10_000;
      const employeeEpf = exactPercentOfWhole(gross, 11);
      const employerEpf = exactPercentOfWhole(gross, 13);
      payee = null;
      narration = 'Monthly payroll run';
      postings = [
        {
          account: 'Expenses:Payroll:Salaries',
          amount: gross,
          currency: homeCurrency,
        },
        {
          account: 'Expenses:Payroll:EPF',
          amount: employerEpf,
          currency: homeCurrency,
        },
        {
          account: 'Liabilities:Current:EPF-Payable',
          amount: -(employeeEpf + employerEpf),
          currency: homeCurrency,
        },
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: -(gross - employeeEpf),
          currency: homeCurrency,
        },
      ];
    } else if (scenarioRoll < 0.85 || foreignCurrencies.length === 0) {
      // Inter-bank transfer.
      const amount = random.nextInt(10, 1_000) * 100;
      const fromAccount = random.pick(CASH_ACCOUNTS);
      let toAccount = random.pick(CASH_ACCOUNTS);
      if (toAccount === fromAccount) {
        toAccount =
          CASH_ACCOUNTS[
            (CASH_ACCOUNTS.indexOf(fromAccount) + 1) % CASH_ACCOUNTS.length
          ];
      }
      payee = random.pick(TRANSFER_PAYEES);
      narration = 'Inter-bank transfer';
      postings = [
        { account: toAccount, amount, currency: homeCurrency },
        { account: fromAccount, amount: -amount, currency: homeCurrency },
      ];
    } else {
      // Export sale in a foreign currency; roughly half also carry a home-
      // currency bank-fee pair, producing a true multi-currency entry that
      // still balances per currency.
      const foreignCurrency = random.pick(foreignCurrencies);
      const amount = random.nextInt(10, 400) * 100;
      payee = random.pick(EXPORT_PAYEES);
      narration = 'Export sales invoice';
      postings = [
        {
          account: 'Assets:Current:Cash-Wise',
          amount,
          currency: foreignCurrency,
        },
        {
          account: 'Income:Sales:Products-Export',
          amount: -amount,
          currency: foreignCurrency,
        },
      ];
      if (random.next() < 0.5) {
        const fee = random.nextInt(1, 20) * 100;
        postings.push(
          {
            account: 'Expenses:Bank:Charges',
            amount: fee,
            currency: homeCurrency,
          },
          {
            account: 'Assets:Current:Cash-Maybank',
            amount: -fee,
            currency: homeCurrency,
          }
        );
      }
    }

    const tags = random.next() < 0.2 ? [random.pick(TAG_POOL)] : [];
    const links =
      random.next() < 0.1 ? [`inv-${random.nextInt(1_000, 10_000)}`] : [];
    drafts.push({
      date,
      flag: pickFlag(random),
      payee,
      narration,
      tags,
      links,
      postings,
    });
  }

  // Sort by date (stable, so same-date drafts keep generation order), then
  // assign sequential ids — the resulting list is already in the store's
  // canonical (date, id) order.
  drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return drafts.map((draft, index) => ({
    id: `e${String(index + 1).padStart(7, '0')}`,
    ...draft,
  }));
}
