'use client';

import type {
  AccountStatusEntry,
  AccountTreeInitialExpansion,
} from '@cynco/accounts';
import { useAccountTree } from '@cynco/accounts/react';
import { workloads } from '@cynco/ledger-test-data';
import { FoldVertical, ListTree } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { ComparisonHeading } from '@/components/ComparisonHeading';

const PANE_HEIGHT = 320;

// The same decorations on both panes: with every group collapsed, each
// status rolls up onto its highest visible ancestor.
const STATUS_ENTRIES: readonly AccountStatusEntry[] = [
  {
    path: 'Assets:Current:Cash-Maybank',
    status: 'unreconciled',
    count: 4,
  },
  { path: 'Assets:Current:AR', status: 'pending', count: 2 },
  { path: 'Liabilities:Current:SST-Payable', status: 'flagged', count: 1 },
];

function ComparisonTree({
  id,
  initialExpansion,
}: {
  id: string;
  initialExpansion: AccountTreeInitialExpansion;
}) {
  const entries = useMemo(() => workloads.small(), []);
  const { ref, getInstance } = useAccountTree({
    id,
    entries,
    currency: 'MYR',
    initialExpansion,
  });

  useEffect(() => {
    getInstance()?.setAccountStatus(STATUS_ENTRIES);
  }, [getInstance]);

  return (
    <div className="border-border overflow-hidden rounded-none border">
      <accounts-container ref={ref} style={{ height: PANE_HEIGHT }} />
    </div>
  );
}

// Side-by-side status roll-up comparison: the accounts API has no
// empty-group flattening, so the pair contrasts an expanded chart against a
// fully collapsed one where the same status dots roll up onto top-level
// ancestors (an empty expansion list keeps every group closed).
export function AccountTreeComparison() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <ComparisonHeading
          icon={<ListTree size={18} />}
          description="Every status dot sits on the account that owns it."
        >
          Expanded
        </ComparisonHeading>
        <ComparisonTree id="tree-compare-expanded" initialExpansion="all" />
      </div>
      <div>
        <ComparisonHeading
          icon={<FoldVertical size={18} />}
          description="Collapsed groups inherit the highest-severity descendant status."
        >
          Status roll-up
        </ComparisonHeading>
        <ComparisonTree id="tree-compare-rollup" initialExpansion={[]} />
      </div>
    </div>
  );
}
