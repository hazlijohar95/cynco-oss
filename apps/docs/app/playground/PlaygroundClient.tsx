'use client';

import { AccountTree } from '@cynco/accounts/react';
import type { LedgerEntry, RegisterRowData } from '@cynco/journals';
import { Register } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-core';
import { workloads } from '@cynco/ledger-test-data';
import { FileUp, Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

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

type ComponentScheme = 'auto' | 'light' | 'dark';

const SCHEMES: readonly ComponentScheme[] = ['auto', 'light', 'dark'];

interface LedgerData {
  entries: LedgerEntry[];
  /** Which load produced this data; keys remounts of tree + register. */
  version: number;
  label: string;
  skippedLines: number[];
}

// First leaf-ish default: the account with the most register rows makes the
// initial right pane interesting without any clicking.
function pickDefaultAccount(
  store: EntryStore,
  entries: LedgerEntry[]
): string | null {
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

// The playground surface: paste or drop a transactions CSV (or load the
// seeded sample ledger), then browse the resulting chart on the left and the
// selected account's register on the right. All wiring goes through the
// packages' public callbacks.
export function PlaygroundClient() {
  const [csvText, setCsvText] = useState('');
  const [data, setData] = useState<LedgerData | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [scheme, setScheme] = useState<ComponentScheme>('auto');
  const [isDragging, setIsDragging] = useState(false);

  const store = useMemo(
    () => (data == null ? null : new EntryStore(data.entries)),
    [data]
  );

  const rows: RegisterRowData[] = useMemo(() => {
    if (store == null || selectedAccount == null) return [];
    return buildRegisterRows(store, selectedAccount);
  }, [store, selectedAccount]);

  const loadEntries = useCallback(
    (entries: LedgerEntry[], label: string, skippedLines: number[] = []) => {
      setData((previous) => ({
        entries,
        version: (previous?.version ?? 0) + 1,
        label,
        skippedLines,
      }));
      setSelectedAccount(pickDefaultAccount(new EntryStore(entries), entries));
    },
    []
  );

  const parseCsv = useCallback(
    (text: string, label: string) => {
      const { entries, skippedLines } = parseCsvLedger(text);
      if (entries.length === 0) return;
      loadEntries(entries, label, skippedLines);
    },
    [loadEntries]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
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
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl">
        <h1 className="text-2xl font-medium">Playground</h1>
        <p className="text-muted-foreground text-md">
          Paste or drop a transactions CSV (
          <code>date,payee,narration,account,amount,currency</code> — one
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
            onChange={(event) => setCsvText(event.target.value)}
            placeholder={SAMPLE_CSV}
            spellCheck={false}
            className="placeholder:text-muted-foreground/50 h-48 w-full resize-y rounded-md border bg-transparent p-3 font-mono text-[13px] leading-5 outline-none"
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
        </div>
      )}

      {data != null && store != null && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5">
            <span className="font-mono text-xs">
              {data.label} · {entryCount.toLocaleString('en-US')} entries ·{' '}
              {rows.length.toLocaleString('en-US')} rows in view
            </span>
            {data.skippedLines.length > 0 && (
              <span className="text-muted-foreground font-mono text-xs">
                {data.skippedLines.length} line
                {data.skippedLines.length === 1 ? '' : 's'} skipped
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                Component theme
              </span>
              <div className="flex items-center gap-0.5">
                {SCHEMES.map((value) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="xs"
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
                  currency: 'MYR',
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
                <div className="text-muted-foreground flex h-[560px] items-center justify-center font-mono text-[13px]">
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
          <p className="text-muted-foreground font-mono text-xs">
            Click a tree row to open its register. Registers include
            descendant-free postings only; balances roll up in the tree.
          </p>
        </>
      )}
    </div>
  );
}
