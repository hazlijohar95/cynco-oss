import { isEntryBalanced, isValidAccountPath } from '@cynco/ledger-core';
import { describe, expect, test } from 'bun:test';

import { CHART_OF_ACCOUNTS } from '../src/chartOfAccounts';
import { generateLedger } from '../src/generateLedger';
import { createSeededRandom } from '../src/seededRandom';
import { workloads } from '../src/workloads';

describe('createSeededRandom', () => {
  test('same seed produces the same stream; different seeds diverge', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const c = createSeededRandom(43);
    const streamA = [a.next(), a.next(), a.nextInt(0, 100), a.next()];
    const streamB = [b.next(), b.next(), b.nextInt(0, 100), b.next()];
    expect(streamA).toEqual(streamB);
    expect(streamA).not.toEqual([
      c.next(),
      c.next(),
      c.nextInt(0, 100),
      c.next(),
    ]);
  });
});

describe('generateLedger', () => {
  const options = {
    seed: 12345,
    entryCount: 500,
    startDate: '2025-01-01',
    endDate: '2025-06-30',
    currencies: ['MYR', 'USD'],
  } as const;

  test('same options produce byte-for-byte identical output', () => {
    const first = generateLedger(options);
    const second = generateLedger(options);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('every generated entry is balanced with valid accounts and dates in range', () => {
    const entries = generateLedger(options);
    expect(entries).toHaveLength(options.entryCount);
    for (const entry of entries) {
      expect(isEntryBalanced(entry)).toBe(true);
      expect(entry.date >= options.startDate).toBe(true);
      expect(entry.date <= options.endDate).toBe(true);
      expect(entry.postings.length).toBeGreaterThanOrEqual(2);
      expect(entry.postings.length).toBeLessThanOrEqual(4);
      for (const posting of entry.postings) {
        expect(Number.isSafeInteger(posting.amount)).toBe(true);
        expect(isValidAccountPath(posting.account)).toBe(true);
        expect(CHART_OF_ACCOUNTS).toContain(posting.account);
      }
    }
  });

  test('output is sorted by (date, id) with sequential ids', () => {
    const entries = generateLedger(options);
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      const inOrder =
        previous.date < current.date ||
        (previous.date === current.date && previous.id < current.id);
      expect(inOrder).toBe(true);
    }
    expect(entries[0].id).toBe('e0000001');
  });

  test('flags and currencies follow the configured distribution shape', () => {
    const entries = generateLedger({ ...options, entryCount: 2_000 });
    const cleared = entries.filter((entry) => entry.flag === 'cleared').length;
    expect(cleared).toBeGreaterThan(entries.length * 0.8);
    const currencies = new Set(
      entries.flatMap((entry) =>
        entry.postings.map((posting) => posting.currency)
      )
    );
    expect([...currencies].sort()).toEqual(['MYR', 'USD']);
    // Occasional true multi-currency entries (per-currency balanced).
    const multiCurrency = entries.filter(
      (entry) => new Set(entry.postings.map((p) => p.currency)).size > 1
    );
    expect(multiCurrency.length).toBeGreaterThan(0);
  });
});

describe('chart of accounts and workloads', () => {
  test('the chart is ~150 unique valid leaf paths', () => {
    expect(CHART_OF_ACCOUNTS.length).toBeGreaterThanOrEqual(140);
    expect(new Set(CHART_OF_ACCOUNTS).size).toBe(CHART_OF_ACCOUNTS.length);
    for (const path of CHART_OF_ACCOUNTS) {
      expect(isValidAccountPath(path)).toBe(true);
    }
  });

  test('the small workload is deterministic and balanced', () => {
    const first = workloads.small();
    const second = workloads.small();
    expect(first).toHaveLength(250);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.every((entry) => isEntryBalanced(entry))).toBe(true);
  });
});
