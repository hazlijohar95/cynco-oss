'use client';

import { Register, type RegisterRowData } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-store';
import { WORKLOAD_ENTRY_COUNTS, workloads } from '@cynco/ledger-test-data';
import { useEffect, useState } from 'react';

import { buildRegisterRows } from './buildRegisterRows';

const REGISTER_ACCOUNT = 'Assets:Current:Cash-Maybank';

// Virtualized register fed by the deterministic `medium` workload (10,000
// entries). Generation and store indexing happen client-side in an effect —
// the static HTML paints instantly with a fixed-height placeholder and the
// rows land a few frames later, keeping first paint clean.
export function RegisterDemo() {
  const [rows, setRows] = useState<RegisterRowData[] | null>(null);

  useEffect(() => {
    const store = new EntryStore(workloads.medium());
    setRows(buildRegisterRows(store, REGISTER_ACCOUNT));
  }, []);

  return (
    <div className="space-y-2">
      <div className="demo-container">
        {rows == null ? (
          <div className="text-muted-foreground flex h-[480px] items-center justify-center font-mono text-[13px]">
            Generating {WORKLOAD_ENTRY_COUNTS.medium.toLocaleString('en-US')}{' '}
            entries…
          </div>
        ) : (
          <Register
            rows={rows}
            options={{ account: REGISTER_ACCOUNT, density: 'comfortable' }}
            style={{ height: 480 }}
          />
        )}
      </div>
      <p className="text-muted-foreground font-mono text-xs">
        {WORKLOAD_ENTRY_COUNTS.medium.toLocaleString('en-US')} entries ·{' '}
        {rows == null ? '…' : rows.length.toLocaleString('en-US')} register rows
        · seeded fixture
      </p>
    </div>
  );
}
