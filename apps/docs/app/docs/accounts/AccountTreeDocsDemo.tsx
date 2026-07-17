'use client';

import { AccountTree } from '@cynco/accounts/react';
import { workloads } from '@cynco/ledger-test-data';
import { useMemo } from 'react';

// Small live tree at the top of the accounts docs page. Client-rendered from
// the seeded `small` workload (250 entries) — cheap enough that SSR preload
// isn't worth the extra plumbing here.
export function AccountTreeDocsDemo() {
  const entries = useMemo(() => workloads.small(), []);
  return (
    <div className="demo-container">
      <AccountTree
        options={{
          entries,
          currency: 'MYR',
          initialExpansion: 'top-level',
        }}
        style={{ height: 360 }}
      />
    </div>
  );
}
