'use client';

import { AccountTree } from '@cynco/accounts/react';
import type { LedgerEntry, RegisterRowData } from '@cynco/journals';
import { Register } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-core';
import { workloads } from '@cynco/ledger-test-data';
import { FileUp, Sparkles } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { parseCsvLedger } from './parseCsvLedger';
import { Button } from '@/components/ui/button';
import { buildRegisterRows } from '@/examples/buildRegisterRows';
import { cn } from '@/lib/utils';

const SAMPLE_CSV = `date,payee,narration,account,amount,currency
2026-07-01,Delima Trading,Invoice for goods delivered,Assets:Current:Cash-Maybank,1250.00,MYR
2026-07-01,Delima Trading,Invoice for goods delivered,Income:Sales:Services-Consulting,-1250.00,MYR
2026-07-03,TNB,Monthly bill,Expenses:Utilities:Electricity-TNB,284.60,MYR
2026-07-03,TNB,Monthly bill,Assets:Current:Cash-Maybank,-284.60,MYR
2026-07-25,,July payroll run,Expenses:Payroll:Salaries,8000.00,MYR
2026-07-25,,July payroll run,Expenses:Payroll:EPF,1040.00,MYR
2026-07-25,,July payroll run,Liabilities:Current:EPF-Payable,-1920.00,MYR
2026-07-25,,July payroll run,Assets:Current:Cash-Maybank,-7120.00,MYR`;

const CSV_COLUMNS = 'date,payee,narration,account,amount,currency';

type ComponentScheme = 'auto' | 'light' | 'dark';

const SCHEMES: readonly ComponentScheme[] = ['auto', 'light', 'dark'];

interface LedgerData {
  entries: LedgerEntry[];
  /** Which load produced this data; keys remounts of tree + register. */
  version: number;
  label: string;
  skippedLines: number[];
}

// Primary display currency for the tree's balance column: the currency the
// pasted data actually uses most (by posting count, first-seen tiebreak).
// The parser accepts any currency per line, so hardcoding MYR would roll up
// wrong-or-empty tree balances for non-MYR CSVs while the register beside
// it stays per-currency correct.
function pickDisplayCurrency(entries: LedgerEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const posting of entry.postings) {
      counts.set(posting.currency, (counts.get(posting.currency) ?? 0) + 1);
    }
  }
  let best = 'MYR';
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

// First leaf-ish default: the account with the most register rows makes the
// initial right pane interesting without any clicking.
function pickDefaultAccount(entries: LedgerEntry[]): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const posting of entry.postings) {
      counts.set(posting.account, (counts.get(posting.account) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [account, count] of counts) {
    if (count > bestCount) {
      best = account;
      bestCount = count;
    }
  }
  return best;
}

// Compact narration of which source lines were dropped: the first few line
// numbers verbatim, then a "+n more" tail.
function describeSkippedLines(skippedLines: number[]): string {
  const shown = skippedLines.slice(0, 5).join(', ');
  const rest = skippedLines.length - 5;
  return `line${skippedLines.length === 1 ? '' : 's'} ${shown}${
    rest > 0 ? ` +${String(rest)} more` : ''
  } skipped`;
}

// The playground surface: paste or drop a transactions CSV (or load the
// seeded sample ledger), then browse the resulting chart on the left and the
// selected account's register on the right. All wiring goes through the
// packages' public callbacks.
export function PlaygroundClient() {
  const [csvText, setCsvText] = useState('');
  const [data, setData] = useState<LedgerData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [scheme, setScheme] = useState<ComponentScheme>('auto');
  const [isDragging, setIsDragging] = useState(false);
  // Drag depth counter: dragleave fires on every child boundary crossing,
  // so the highlight only clears when the counter returns to zero.
  const dragDepthRef = useRef(0);

  const store = useMemo(
    () => (data == null ? null : new EntryStore(data.entries)),
    [data]
  );

  const rows: RegisterRowData[] = useMemo(() => {
    if (store == null || selectedAccount == null) return [];
    return buildRegisterRows(store, selectedAccount);
  }, [store, selectedAccount]);

  const displayCurrency = useMemo(
    () => (data == null ? 'MYR' : pickDisplayCurrency(data.entries)),
    [data]
  );

  const loadEntries = useCallback(
    (entries: LedgerEntry[], label: string, skippedLines: number[] = []) => {
      setParseError(null);
      setData((previous) => ({
        entries,
        version: (previous?.version ?? 0) + 1,
        label,
        skippedLines,
      }));
      setSelectedAccount(pickDefaultAccount(entries));
    },
    []
  );

  const parseCsv = useCallback(
    (text: string, label: string) => {
      const { entries, skippedLines } = parseCsvLedger(text);
      if (entries.length === 0) {
        // Every line failed: say so, say how many, and restate the contract
        // — a silent no-op here would look like a dead button.
        setParseError(
          `No valid postings found${
            skippedLines.length > 0
              ? ` — ${String(skippedLines.length)} line${
                  skippedLines.length === 1 ? '' : 's'
                } skipped`
              : ''
          }. Expected columns: ${CSV_COLUMNS} (ISO dates, one posting per line).`
        );
        return;
      }
      loadEntries(entries, label, skippedLines);
    },
    [loadEntries]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file == null) return;
      void file.text().then((text) => {
        setCsvText(text);
        parseCsv(text, file.name);
      });
    },
    [parseCsv]
  );

  const entryCount = data?.entries.length ?? 0;

  return (
    <div
      className="space-y-4"
      onDragEnter={() => {
        dragDepthRef.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-medium">Playground</h1>
        <p className="text-muted-foreground text-base">
          Paste or drop a transactions CSV (<code>{CSV_COLUMNS}</code> — one
          posting per line), or load the seeded sample ledger. Amounts are
          parsed with exact string math into integer minor units.
        </p>
      </div>

      {data == null && (
        <div
          className={cn(
            'space-y-3 rounded-lg border p-4 transition-colors duration-150',
            isDragging && 'border-ring bg-muted/50'
          )}
        >
          <textarea
            value={csvText}
            onChange={(event) => {
              setParseError(null);
              setCsvText(event.target.value);
            }}
            placeholder={SAMPLE_CSV}
            spellCheck={false}
            aria-label="Transactions CSV"
            className="placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-ring/50 h-48 w-full resize-y rounded-md border bg-transparent p-3 text-[13px] leading-5 outline-none focus-visible:ring-[3px]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => parseCsv(csvText, 'pasted CSV')}
              disabled={csvText.trim() === ''}
            >
              <FileUp size={16} />
              Parse CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => loadEntries(workloads.small(), 'sample ledger')}
            >
              <Sparkles size={16} />
              Load sample ledger
            </Button>
            <span className="text-muted-foreground text-sm">
              …or drop a .csv file anywhere on this panel.
            </span>
          </div>
          {parseError != null && (
            <p aria-live="polite" className="text-destructive text-sm">
              {parseError}
            </p>
          )}
        </div>
      )}

      {data != null && store != null && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5">
            <span className="text-xs">
              {data.label} · {entryCount.toLocaleString('en-US')} entries ·{' '}
              {rows.length.toLocaleString('en-US')} rows in view
            </span>
            {data.skippedLines.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {describeSkippedLines(data.skippedLines)}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                Component theme
              </span>
              <div
                role="group"
                aria-label="Component color scheme"
                className="flex items-center gap-0.5"
              >
                {SCHEMES.map((value) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="xs"
                    aria-pressed={scheme === value}
                    onClick={() => setScheme(value)}
                    className={cn(
                      'text-muted-foreground font-normal capitalize',
                      scheme === value && 'text-foreground bg-muted font-medium'
                    )}
                  >
                    {value}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground font-normal"
                onClick={() => {
                  setData(null);
                  setSelectedAccount(null);
                }}
              >
                Reset
              </Button>
            </div>
          </div>

          <div
            className="grid gap-4 md:grid-cols-[minmax(260px,340px)_1fr]"
            style={scheme === 'auto' ? undefined : { colorScheme: scheme }}
          >
            <div className="demo-container">
              <AccountTree
                key={`tree-${data.version}`}
                options={{
                  entries: data.entries,
                  currency: displayCurrency,
                  initialExpansion: 'all',
                  onSelect: (selectedPaths, focusedPath) => {
                    const path = selectedPaths[0] ?? focusedPath;
                    if (path != null) setSelectedAccount(path);
                  },
                }}
                style={{ height: 560 }}
              />
            </div>
            <div className="demo-container min-w-0">
              {selectedAccount == null || rows.length === 0 ? (
                <div className="text-muted-foreground flex h-[560px] items-center justify-center text-[13px]">
                  Select an account with activity to view its register.
                </div>
              ) : (
                <Register
                  key={`register-${data.version}-${selectedAccount}`}
                  rows={rows}
                  options={{ account: selectedAccount, density: 'compact' }}
                  style={{ height: 560 }}
                />
              )}
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Click a tree row to open its register. A register shows postings to
            the exact account only; child-account balances roll up in the tree.
          </p>
        </>
      )}
    </div>
  );
}
