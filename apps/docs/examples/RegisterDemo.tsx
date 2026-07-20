'use client';

import type { RegisterDensity } from '@cynco/journals';
import { Register, type RegisterRowData } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-core';
import {
  WORKLOAD_ENTRY_COUNTS,
  type WorkloadName,
  workloads,
} from '@cynco/ledger-test-data';
import {
  AlignJustify,
  Check,
  ChevronDown,
  Database,
  Rows3,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { buildRegisterRows } from './buildRegisterRows';
import { useInViewOnce } from './useInViewOnce';
import { Footnote } from '@/components/Footnote';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { afterNextPaint } from '@/lib/afterNextPaint';

const REGISTER_ACCOUNT = 'Assets:Current:Cash-Maybank';

/** The two seeded workloads offered by the picker. */
const REGISTER_WORKLOADS: readonly WorkloadName[] = ['small', 'medium'];

function workloadLabel(name: WorkloadName): string {
  return `${WORKLOAD_ENTRY_COUNTS[name].toLocaleString('en-US')} entries`;
}

// Virtualized register with a density segmented control and a workload
// picker. Generation and store indexing happen client-side in an effect —
// the static HTML paints instantly with a fixed-height placeholder, and the
// 10k-entry generation is deferred until the section approaches the
// viewport so it never competes with initial hydration. Density affects the
// fixed row height the window math depends on, so the Register remounts
// (via key) rather than re-rendering in place.
export function RegisterDemo() {
  const [workload, setWorkload] = useState<WorkloadName>('medium');
  const [density, setDensity] = useState<RegisterDensity>('comfortable');
  const [rows, setRows] = useState<RegisterRowData[] | null>(null);
  const { ref, inView } = useInViewOnce<HTMLDivElement>();

  // Generation is synchronous, so the "Generating…" placeholder is allowed
  // to paint first (afterNextPaint) before the block runs — otherwise a
  // workload switch freezes the tab with the old rows still on screen.
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    setRows(null);
    void afterNextPaint().then(() => {
      if (cancelled) return;
      const store = new EntryStore(workloads[workload]());
      setRows(buildRegisterRows(store, REGISTER_ACCOUNT));
    });
    return () => {
      cancelled = true;
    };
  }, [workload, inView]);

  return (
    <div ref={ref} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup
          value={density}
          aria-label="Register density"
          onValueChange={setDensity}
        >
          <ButtonGroupItem value="comfortable">
            <Rows3 size={16} />
            Comfortable
          </ButtonGroupItem>
          <ButtonGroupItem value="compact">
            <AlignJustify size={16} />
            Compact
          </ButtonGroupItem>
        </ButtonGroup>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-[180px] justify-start">
              <Database size={16} />
              {workloadLabel(workload)}
              <ChevronDown
                size={14}
                className="text-muted-foreground ml-auto"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REGISTER_WORKLOADS.map((name) => (
              <DropdownMenuItem
                key={name}
                selected={workload === name}
                onClick={() => setWorkload(name)}
              >
                {workloadLabel(name)}
                {workload === name && <Check size={14} className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="demo-container">
        {rows == null ? (
          <div className="text-muted-foreground flex h-[480px] items-center justify-center font-mono text-[13px]">
            Generating {workloadLabel(workload)}…
          </div>
        ) : (
          <Register
            key={`${workload}-${density}`}
            rows={rows}
            options={{ account: REGISTER_ACCOUNT, density }}
            style={{ height: 480 }}
          />
        )}
      </div>
      <Footnote>
        {workloadLabel(workload)} ·{' '}
        {rows == null ? '…' : rows.length.toLocaleString('en-US')} register rows
        · a seeded fixture, so every visit renders byte-identical data.
      </Footnote>
    </div>
  );
}
