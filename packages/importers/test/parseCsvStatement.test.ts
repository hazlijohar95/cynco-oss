import { describe, expect, test } from 'bun:test';

import { ImportError } from '../src/errors';
import { parseCsvStatement } from '../src/parseCsvStatement';
import type { CsvMapping } from '../src/types';

const BASIC_MAPPING: CsvMapping = {
  columns: { date: 0, description: 1, amount: 2 },
  dateFormat: 'YYYY-MM-DD',
  amountFormat: { decimal: '.', group: ',' },
  currency: 'MYR',
};

describe('parseCsvStatement', () => {
  test('happy path: indexed columns, no header', () => {
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01,COFFEE BEAN KLCC,-15.90\n2026-03-02,SALARY MARCH,"4,500.00"\n',
      BASIC_MAPPING
    );
    expect(skipped).toEqual([]);
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({
      date: '2026-03-01',
      description: 'COFFEE BEAN KLCC',
      amount: -1590,
      currency: 'MYR',
    });
    expect(lines[1].amount).toBe(450_000);
  });

  test('header names resolve columns and imply hasHeader', () => {
    const { lines, skipped } = parseCsvStatement(
      'Date,Details,Amount\r\n2026-03-01,GRAB RIDE,-23.00\r\n',
      {
        ...BASIC_MAPPING,
        columns: { date: 'Date', description: 'Details', amount: 'Amount' },
      }
    );
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(-2300);
  });

  test('unknown header name throws a typed structural error', () => {
    expect(() =>
      parseCsvStatement('Date,Amount\n2026-03-01,1.00\n', {
        ...BASIC_MAPPING,
        columns: { date: 'Date', description: 'Nope', amount: 'Amount' },
      })
    ).toThrow(ImportError);
  });

  test('semicolon delimiter', () => {
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01;LUNCH, WITH FRIENDS;-8.50\n',
      { ...BASIC_MAPPING, delimiter: ';' }
    );
    expect(skipped).toEqual([]);
    expect(lines[0].description).toBe('LUNCH, WITH FRIENDS');
    expect(lines[0].amount).toBe(-850);
  });

  test('quoted fields: embedded delimiters, escaped quotes, embedded newlines', () => {
    const csv =
      '2026-03-01,"ACME, INC ""INVOICE""\nSECOND LINE",-100.00\n2026-03-02,PLAIN,5.00\n';
    const { lines, skipped } = parseCsvStatement(csv, BASIC_MAPPING);
    expect(skipped).toEqual([]);
    expect(lines[0].description).toBe('ACME, INC "INVOICE"\nSECOND LINE');
    expect(lines[0].amount).toBe(-10_000);
    // The record after an embedded newline keeps an accurate physical line.
    expect(lines[1].date).toBe('2026-03-02');
  });

  test('unterminated quote throws CSV_STRUCTURE', () => {
    let caught: unknown;
    try {
      parseCsvStatement('2026-03-01,"RUNAWAY,-1.00\n', BASIC_MAPPING);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).code).toBe('CSV_STRUCTURE');
  });

  test('debit/credit split columns: credit is money in, debit money out', () => {
    const mapping: CsvMapping = {
      ...BASIC_MAPPING,
      columns: {
        date: 0,
        description: 1,
        amount: { debit: 2, credit: 3 },
      },
    };
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01,POS PURCHASE,45.00,\n2026-03-02,DEPOSIT,,120.00\n2026-03-03,AMBIGUOUS,1.00,2.00\n2026-03-04,EMPTY,,\n',
      mapping
    );
    expect(lines.map((line) => line.amount)).toEqual([-4500, 12_000]);
    expect(skipped).toEqual([
      { line: 3, reason: expect.stringContaining('ambiguous') },
      { line: 4, reason: expect.stringContaining('empty') },
    ]);
  });

  test('European bank: DD/MM/YYYY dates, comma decimal, dot grouping', () => {
    const { lines, skipped } = parseCsvStatement(
      '01/03/2026;MIETE MÄRZ;-1.250,00\n15/03/2026;GEHALT;3.000,50\n',
      {
        delimiter: ';',
        columns: { date: 0, description: 1, amount: 2 },
        dateFormat: 'DD/MM/YYYY',
        amountFormat: { decimal: ',', group: '.' },
        currency: 'EUR',
      }
    );
    expect(skipped).toEqual([]);
    expect(lines[0]).toMatchObject({ date: '2026-03-01', amount: -125_000 });
    expect(lines[1]).toMatchObject({ date: '2026-03-15', amount: 300_050 });
  });

  test('DD.MM.YYYY dates parse', () => {
    const { lines } = parseCsvStatement('01.03.2026,X,-1.00\n', {
      ...BASIC_MAPPING,
      dateFormat: 'DD.MM.YYYY',
      amountFormat: { decimal: '.' },
    });
    expect(lines[0].date).toBe('2026-03-01');
  });

  test('MM/DD/YYYY dates parse', () => {
    const { lines } = parseCsvStatement('03/01/2026,X,-1.00\n', {
      ...BASIC_MAPPING,
      dateFormat: 'MM/DD/YYYY',
    });
    expect(lines[0].date).toBe('2026-03-01');
  });

  test('zero-decimal currency: whole units ARE minor units, decimals rejected', () => {
    const mapping: CsvMapping = { ...BASIC_MAPPING, currency: 'JPY' };
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01,RAMEN,-1200\n2026-03-02,BAD,-12.50\n',
      mapping
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(-1200);
    expect(skipped).toEqual([
      { line: 2, reason: expect.stringContaining('JPY allows 0') },
    ]);
  });

  test('three-decimal currency scales to mils', () => {
    const { lines } = parseCsvStatement('2026-03-01,DINAR,-1.250\n', {
      ...BASIC_MAPPING,
      currency: 'BHD',
    });
    expect(lines[0].amount).toBe(-1250);
  });

  test('too many decimals for a 2-decimal currency is rejected with reason', () => {
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01,FRACTION,-1.005\n',
      BASIC_MAPPING
    );
    expect(lines).toEqual([]);
    expect(skipped).toEqual([
      { line: 1, reason: expect.stringContaining('MYR allows 2') },
    ]);
  });

  test('short fractions are zero-padded, never floated', () => {
    const { lines } = parseCsvStatement('2026-03-01,PAD,12.5\n', BASIC_MAPPING);
    expect(lines[0].amount).toBe(1250);
  });

  test('skipped rows carry the 1-based line and a reason; good rows still parse', () => {
    const { lines, skipped } = parseCsvStatement(
      '2026-03-01,GOOD,-1.00\nnot-a-date,BAD DATE,-2.00\n2026-03-03,BAD AMOUNT,abc\n\n2026-03-05,SHORT\n2026-03-06,GOOD TOO,6.00\n',
      BASIC_MAPPING
    );
    expect(lines.map((line) => line.description)).toEqual(['GOOD', 'GOOD TOO']);
    expect(skipped).toEqual([
      { line: 2, reason: expect.stringContaining('does not match') },
      { line: 3, reason: expect.stringContaining('not a plain decimal') },
      { line: 4, reason: 'blank line' },
      { line: 5, reason: expect.stringContaining('missing') },
    ]);
  });

  test('invalid calendar dates are rejected', () => {
    const { skipped } = parseCsvStatement(
      '2026-02-30,NOT A DAY,-1.00\n',
      BASIC_MAPPING
    );
    expect(skipped).toEqual([
      { line: 1, reason: expect.stringContaining('not a valid calendar date') },
    ]);
  });

  test('ids are deterministic across reruns and distinct for identical rows', () => {
    const csv = '2026-03-01,DUP,-1.00\n2026-03-01,DUP,-1.00\n';
    const first = parseCsvStatement(csv, BASIC_MAPPING);
    const second = parseCsvStatement(csv, BASIC_MAPPING);
    expect(first.lines.map((line) => line.id)).toEqual(
      second.lines.map((line) => line.id)
    );
    expect(first.lines[0].id).not.toBe(first.lines[1].id);
    expect(first.lines[0].id.startsWith('csv:')).toBe(true);
  });

  test('balance and reference columns populate the import-only extras', () => {
    const { lines } = parseCsvStatement(
      '2026-03-01,OPENING SPEND,-10.00,990.00,CHQ001\n',
      {
        ...BASIC_MAPPING,
        columns: {
          date: 0,
          description: 1,
          amount: 2,
          balance: 3,
          reference: 4,
        },
      }
    );
    expect(lines[0].balance).toBe(99_000);
    expect(lines[0].reference).toBe('CHQ001');
  });
});
