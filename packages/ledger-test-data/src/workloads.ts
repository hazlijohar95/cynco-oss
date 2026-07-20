// Named fixture workloads with pinned seeds, so every test and benchmark in
// the suite agrees on what "medium" means. Each workload is a lazy call —
// the xl workload takes noticeable time and memory to generate, and callers
// that only need `small` must not pay for it.

import type { LedgerEntry } from '@cynco/ledger-core';

import { generateLedger } from './generateLedger';

/** The named workload sizes shared by tests and benchmarks. */
export type WorkloadName = 'small' | 'medium' | 'large' | 'xl';

/** Entry counts per workload, exported so reports can label results. */
export const WORKLOAD_ENTRY_COUNTS: Readonly<Record<WorkloadName, number>> = {
  small: 250,
  medium: 10_000,
  large: 100_000,
  xl: 1_000_000,
};

/**
 * Lazy generators for each workload. Seeds and date ranges are pinned:
 * calling the same workload twice yields identical entries.
 */
export const workloads: Readonly<Record<WorkloadName, () => LedgerEntry[]>> = {
  small: (): LedgerEntry[] =>
    generateLedger({
      seed: 0xc0ffee,
      entryCount: WORKLOAD_ENTRY_COUNTS.small,
      startDate: '2025-01-01',
      endDate: '2025-03-31',
      currencies: ['MYR', 'USD'],
    }),
  medium: (): LedgerEntry[] =>
    generateLedger({
      seed: 0xdecaf,
      entryCount: WORKLOAD_ENTRY_COUNTS.medium,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      currencies: ['MYR', 'USD'],
    }),
  large: (): LedgerEntry[] =>
    generateLedger({
      seed: 0xbeef,
      entryCount: WORKLOAD_ENTRY_COUNTS.large,
      startDate: '2023-01-01',
      endDate: '2025-12-31',
      currencies: ['MYR', 'USD', 'SGD'],
    }),
  xl: (): LedgerEntry[] =>
    generateLedger({
      seed: 0xfade,
      entryCount: WORKLOAD_ENTRY_COUNTS.xl,
      startDate: '2020-01-01',
      endDate: '2025-12-31',
      currencies: ['MYR', 'USD', 'SGD', 'EUR'],
    }),
};
