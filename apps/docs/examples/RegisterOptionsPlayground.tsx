'use client';

import type {
  RegisterDensity,
  RegisterGroupBy,
  RegisterSelectionMode,
} from '@cynco/journals';
import { Register } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-core';
import { generateLedger } from '@cynco/ledger-test-data';
import {
  AlignJustify,
  CalendarRange,
  ListX,
  MousePointerClick,
  Rows3,
  TextSelect,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { buildRegisterRows } from './buildRegisterRows';
import { Footnote } from '@/components/Footnote';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const PLAYGROUND_ACCOUNT = 'Assets:Current:Cash-Maybank';

// Playground-only fixture: 500 seeded entries over six months, one
// currency. Same generator as the named workloads, pinned seed, so every
// visit renders byte-identical data.
function playgroundEntries() {
  return generateLedger({
    seed: 0x0500,
    entryCount: 500,
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    currencies: ['MYR'],
  });
}

// Interactive options panel for the Register: density, groupBy, and
// selectionMode drive a live 500-entry register, and the options object is
// mirrored as real code below the controls. Density and groupBy reshape the
// fixed-height virtual row space, so option changes remount the Register
// via key — the same pattern the landing demo uses.
export function RegisterOptionsPlayground() {
  const [density, setDensity] = useState<RegisterDensity>('comfortable');
  const [groupBy, setGroupBy] = useState<RegisterGroupBy>('none');
  const [selectionMode, setSelectionMode] =
    useState<RegisterSelectionMode>('single');
  const [selectedCount, setSelectedCount] = useState(0);

  const rows = useMemo(() => {
    const store = new EntryStore(playgroundEntries());
    return buildRegisterRows(store, PLAYGROUND_ACCOUNT);
  }, []);

  const snippet = [
    'const register = new Register({',
    `  account: '${PLAYGROUND_ACCOUNT}',`,
    `  density: '${density}',`,
    `  groupBy: '${groupBy}',`,
    `  selectionMode: '${selectionMode}',`,
    '});',
  ].join('\n');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup<RegisterDensity>
          value={density}
          aria-label="density"
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

        <ButtonGroup<RegisterGroupBy>
          value={groupBy}
          aria-label="groupBy"
          onValueChange={setGroupBy}
        >
          <ButtonGroupItem value="none">
            <ListX size={16} />
            Flat
          </ButtonGroupItem>
          <ButtonGroupItem value="month">
            <CalendarRange size={16} />
            By month
          </ButtonGroupItem>
        </ButtonGroup>

        <ButtonGroup<RegisterSelectionMode>
          value={selectionMode}
          aria-label="selectionMode"
          onValueChange={(mode) => {
            setSelectionMode(mode);
            setSelectedCount(0);
          }}
        >
          <ButtonGroupItem value="single">
            <MousePointerClick size={16} />
            Single
          </ButtonGroupItem>
          <ButtonGroupItem value="range">
            <TextSelect size={16} />
            Range
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      {/* The options object as real code — a plain mono mirror kept in
          lockstep with the controls above, no runtime highlighter. */}
      <pre
        aria-label="Current Register options"
        className="border-border bg-secondary/50 m-0 overflow-x-auto border p-4 font-mono text-[13px] leading-5"
      >
        {snippet}
      </pre>

      <div className="demo-container">
        <Register
          key={`${density}-${groupBy}-${selectionMode}`}
          rows={rows}
          options={{
            account: PLAYGROUND_ACCOUNT,
            density,
            groupBy,
            selectionMode,
            onSelectionChange: ({ indexes }) =>
              setSelectedCount(indexes.length),
          }}
          style={{ height: 420 }}
        />
      </div>
      <Footnote>
        500 seeded entries · {rows.length.toLocaleString('en-US')} register rows
        · {selectedCount.toLocaleString('en-US')} selected — in range mode,
        shift-click or Shift+<kbd>↓</kbd>/<kbd>↑</kbd> extends from the anchor.
        Option changes remount via React key; selection, focus, and callbacks
        stay in entry-index space under grouping.
      </Footnote>
    </div>
  );
}
