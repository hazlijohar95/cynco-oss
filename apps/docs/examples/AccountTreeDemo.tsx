'use client';

import type { AccountStatusEntry } from '@cynco/accounts';
import { templateRender, useAccountTree } from '@cynco/accounts/react';
import { workloads } from '@cynco/ledger-test-data';
import { useEffect, useMemo } from 'react';

import { ACCOUNT_TREE_DEMO_ID } from './entries';

// Status decorations are view state (not part of the controller options), so
// they are applied post-hydration through the imperative instance API.
const STATUS_ENTRIES: readonly AccountStatusEntry[] = [
  {
    path: 'Assets:Current:Cash-Maybank',
    status: 'unreconciled',
    count: 4,
  },
  { path: 'Assets:Current:AR', status: 'pending', count: 2 },
  { path: 'Liabilities:Current:SST-Payable', status: 'flagged', count: 1 },
];

export interface AccountTreeDemoProps {
  /** Shadow-root HTML from `preloadAccountTreeHTML`, rendered on the server. */
  ssrHTML: string;
}

// Chart-of-accounts tree over the deterministic `small` workload. The server
// pre-renders the same controller state (same entries, same id), so the
// client adopts the SSR shadow root in place and only layers on the status
// dots after mount.
export function AccountTreeDemo({ ssrHTML }: AccountTreeDemoProps) {
  // workloads.small() is seeded: this regenerates byte-identical entries to
  // the ones the server preloaded, without serializing 250 entries as props.
  const entries = useMemo(() => workloads.small(), []);
  const { ref, getInstance } = useAccountTree({
    id: ACCOUNT_TREE_DEMO_ID,
    entries,
    currency: 'MYR',
    initialExpansion: 'top-level',
  });

  useEffect(() => {
    getInstance()?.setAccountStatus(STATUS_ENTRIES);
  }, [getInstance]);

  return (
    <div className="space-y-2">
      <div className="demo-container">
        <accounts-container ref={ref} style={{ height: 420 }}>
          {templateRender(null, ssrHTML)}
        </accounts-container>
      </div>
      <p className="text-muted-foreground font-mono text-xs">
        250 entries · rolled-up balances · status dots via setAccountStatus()
      </p>
    </div>
  );
}
