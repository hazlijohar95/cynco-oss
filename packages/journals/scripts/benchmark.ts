import { bench, run, summary } from 'mitata';

import { renderEntryHTML } from '../src/renderers/EntryRenderer';
import { renderRegisterRowsHTML } from '../src/renderers/RegisterRenderer';
import type { LedgerEntry, RegisterRowData } from '../src/types';
import { formatMinorUnits } from '../src/utils/formatMinorUnits';

// Deterministic fixture data: benchmarks must not depend on Math.random so
// run-to-run comparisons stay meaningful.
function makeEntry(index: number): LedgerEntry {
  const amount = (index % 997) * 100 + 45;
  return {
    id: `entry-${index}`,
    date: '2026-07-18',
    flag: index % 7 === 0 ? 'pending' : 'cleared',
    payee: `Payee ${index % 53}`,
    narration: `Invoice ${index} settlement`,
    tags: index % 5 === 0 ? ['ops', 'monthly'] : [],
    links: index % 11 === 0 ? [`inv-${index}`] : [],
    postings: [
      { account: 'Assets:Current:Cash-Maybank', amount, currency: 'MYR' },
      { account: 'Income:Sales:Consulting', amount: -amount, currency: 'MYR' },
    ],
  };
}

function makeRows(count: number): RegisterRowData[] {
  const rows: RegisterRowData[] = [];
  let balance = 0;
  for (let index = 0; index < count; index += 1) {
    const entry = makeEntry(index);
    const posting = entry.postings[0];
    balance += posting.amount;
    rows.push({
      entry,
      posting,
      runningBalance: new Map([['MYR', balance]]),
    });
  }
  return rows;
}

const ENTRY = makeEntry(42);
const ROWS = makeRows(100_000);

summary(() => {
  bench('formatMinorUnits: 2-decimal', () => {
    return formatMinorUnits(123_456_789, 'MYR');
  });

  bench('formatMinorUnits: 0-decimal negative', () => {
    return formatMinorUnits(-123_456_789, 'JPY');
  });

  bench('renderEntryHTML: 2-posting entry', () => {
    return renderEntryHTML(ENTRY, { showLineNumbers: true });
  });

  bench('renderRegisterRowsHTML: 60-row window of 100k', () => {
    return renderRegisterRowsHTML(ROWS, { start: 50_000, end: 50_060 }, null);
  });
});

await run();
