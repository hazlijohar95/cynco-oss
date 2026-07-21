import { describe, expect, test } from 'bun:test';

import { CURRENCY_DECIMALS } from '../src/constants';
import { parseCsvStatement } from '../src/parseCsvStatement';
import type { ImportedStatementLine, StatementLine } from '../src/types';

// Importers may not depend on @cynco/journals (assert-tiers forbids the
// domain→domain edge) so the consumed shapes are DUPLICATED in src/types.ts.
// These tests are the lockstep guard: they read the journals source AS TEXT
// and fail the moment either copy drifts — the same failure mode that once
// let a partial currency-table copy mis-scale JPY/BHD 100×/10× goes red here
// instead of in production. Source-text comparison (not a type import)
// because pulling journals/src into this composite program would defeat the
// point of not depending on it.

const JOURNALS_TYPES = await Bun.file(
  new URL('../../journals/src/types.ts', import.meta.url)
).text();
const JOURNALS_CONSTANTS = await Bun.file(
  new URL('../../journals/src/constants.ts', import.meta.url)
).text();
const IMPORTERS_TYPES = await Bun.file(
  new URL('../src/types.ts', import.meta.url)
).text();
const IMPORTERS_CONSTANTS = await Bun.file(
  new URL('../src/constants.ts', import.meta.url)
).text();

/**
 * Extracts the member signatures of `export interface <name> { ... }` from a
 * source text: comments stripped, whitespace collapsed, one string per
 * member. Comparing member lists (rather than raw text) keeps the guard
 * insensitive to doc-comment wording, which legitimately differs per package.
 */
function interfaceMembers(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = source.indexOf('{', start) + 1;
  let depth = 1;
  let end = bodyStart;
  while (depth > 0 && end < source.length) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    end += 1;
  }
  const body = source
    .slice(bodyStart, end - 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return body
    .split(';')
    .map((member) => member.replace(/\s+/g, ' ').trim())
    .filter((member) => member !== '');
}

/** Extracts a `type <name> = ...;` alias's right-hand side, normalized. */
function typeAlias(source: string, name: string): string {
  const match = new RegExp(`export type ${name} =([^;]+);`).exec(source);
  expect(match).not.toBeNull();
  return (match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

/** Extracts the `XXX: n,` entries of a CURRENCY_DECIMALS-style table literal. */
function tableEntries(source: string): Record<string, number> {
  const start = source.indexOf('CURRENCY_DECIMALS');
  expect(start).toBeGreaterThan(-1);
  const bodyStart = source.indexOf('{', start) + 1;
  const bodyEnd = source.indexOf('}', bodyStart);
  const entries: Record<string, number> = {};
  for (const match of source
    .slice(bodyStart, bodyEnd)
    .matchAll(/([A-Z]{3}):\s*(\d+)/g)) {
    entries[match[1] ?? ''] = Number(match[2]);
  }
  return entries;
}

describe('lockstep parity with @cynco/journals', () => {
  test('StatementLine members are identical', () => {
    expect(interfaceMembers(IMPORTERS_TYPES, 'StatementLine')).toEqual(
      interfaceMembers(JOURNALS_TYPES, 'StatementLine')
    );
  });

  test('LedgerEntry and Posting members are identical', () => {
    expect(interfaceMembers(IMPORTERS_TYPES, 'LedgerEntry')).toEqual(
      interfaceMembers(JOURNALS_TYPES, 'LedgerEntry')
    );
    expect(interfaceMembers(IMPORTERS_TYPES, 'Posting')).toEqual(
      interfaceMembers(JOURNALS_TYPES, 'Posting')
    );
  });

  test('EntryFlag and MinorUnits aliases are identical', () => {
    expect(typeAlias(IMPORTERS_TYPES, 'EntryFlag')).toBe(
      typeAlias(JOURNALS_TYPES, 'EntryFlag')
    );
    expect(typeAlias(IMPORTERS_TYPES, 'MinorUnits')).toBe(
      typeAlias(JOURNALS_TYPES, 'MinorUnits')
    );
  });

  test('CURRENCY_DECIMALS mirrors the journals table entry for entry', () => {
    expect(tableEntries(IMPORTERS_CONSTANTS)).toEqual(
      tableEntries(JOURNALS_CONSTANTS)
    );
    // And the runtime export agrees with its own source text.
    expect({ ...CURRENCY_DECIMALS }).toEqual(tableEntries(IMPORTERS_CONSTANTS));
  });

  test('parser output is assignable to the reconciliation input shape', () => {
    const { lines } = parseCsvStatement('2026-03-01,ROUND TRIP,-1.00\n', {
      columns: { date: 0, description: 1, amount: 2 },
      dateFormat: 'YYYY-MM-DD',
      amountFormat: { decimal: '.' },
      currency: 'MYR',
    });
    // Compile-time: ImportedStatementLine narrows to StatementLine with no
    // adaptation — exactly what feeding journals' proposeMatches requires.
    const asReconciliationInput: readonly StatementLine[] = lines;
    const roundTrip: ImportedStatementLine[] = [...lines];
    expect(asReconciliationInput).toHaveLength(1);
    expect(roundTrip[0]).toMatchObject({
      id: expect.stringContaining('csv:'),
      date: '2026-03-01',
      description: 'ROUND TRIP',
      amount: -100,
      currency: 'MYR',
    });
  });
});
