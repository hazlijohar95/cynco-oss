'use client';

import { deriveTrialBalance } from '@cynco/statements';
import { TrialBalance } from '@cynco/statements/react';
import { Columns3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  STATEMENT_ENTRIES,
  STATEMENT_TAXONOMY,
  TRIAL_BALANCE_AS_OF,
} from './statementEntries';
import { Footnote } from '@/components/Footnote';
import { SwitchPill } from '@/components/ui/switch-pill';

// Live trial balance over the two-year fixture ledger. The toggle rederives
// with `adjustments: { tag: 'adjustment' }`, widening the two amount columns
// into the six-column working trial balance (unadjusted / adjustments /
// adjusted) — the fixture's year-end depreciation entries carry that tag.
export function TrialBalanceDemo() {
  const [showAdjustments, setShowAdjustments] = useState(false);

  const data = useMemo(
    () =>
      deriveTrialBalance(STATEMENT_ENTRIES, {
        taxonomy: STATEMENT_TAXONOMY,
        asOf: TRIAL_BALANCE_AS_OF,
        ...(showAdjustments ? { adjustments: { tag: 'adjustment' } } : {}),
      }),
    [showAdjustments]
  );

  return (
    <div className="space-y-4">
      <SwitchPill
        icon={<Columns3 size={16} />}
        label="Adjustment columns"
        checked={showAdjustments}
        onCheckedChange={setShowAdjustments}
      />
      <div className="demo-container">
        <TrialBalance data={data} options={{ showClassification: true }} />
      </div>
      <Footnote>
        Debits tie to credits on the computed proof line —{' '}
        <code>Suspense:Pending-Query</code> renders flagged as unclassified
        (never guessed into a type), and the contra-overridden accumulated
        depreciation sits in credit without an abnormal flag.
      </Footnote>
    </div>
  );
}
