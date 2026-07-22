'use client';

import { AccountTree } from '@cynco/accounts/react';
import { workloads } from '@cynco/ledger-test-data';
import { useMemo } from 'react';

import { ACCOUNTS_DOCS_TREE_ID } from '@/examples/entries';

export interface AccountTreeDocsDemoProps {
  /** Shadow-root HTML from `preloadAccountTreeHTML`, rendered in page.tsx. */
  ssrHTML: string;
}

// Live tree at the top of the accounts docs page, server-prerendered: the
// page wrapper preloads the shadow-root HTML with the shared id and the
// client adopts it in place. workloads.small() is seeded, so the client
// regenerates entries byte-identical to the ones the server rendered from.
export function AccountTreeDocsDemo({ ssrHTML }: AccountTreeDocsDemoProps) {
  const entries = useMemo(() => workloads.small(), []);
  return (
    <div className="demo-container">
      <AccountTree
        options={{
          id: ACCOUNTS_DOCS_TREE_ID,
          entries,
          currency: 'MYR',
          initialExpansion: 'top-level',
        }}
        ssrHTML={ssrHTML}
        style={{ height: 360 }}
      />
    </div>
  );
}
