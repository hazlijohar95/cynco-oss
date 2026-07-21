'use client';

import { deriveBalanceSheet } from '@cynco/statements';
import { BalanceSheet } from '@cynco/statements/react';
import { useMemo } from 'react';

import {
  BALANCE_SHEET_DATES,
  STATEMENT_ENTRIES,
  STATEMENT_TAXONOMY,
} from './statementEntries';
import { Footnote } from '@/components/Footnote';

// Live comparative balance sheet over the fixture ledger: two year-end
// columns whose fiscal-year starts split the virtual closing into retained
// and current-year earnings. The fixture's unclassified suspense balance
// makes the accounting equation miss by exactly RM 500.00 — shown as a
// flagged difference row, never plugged.
export function BalanceSheetDemo() {
  const data = useMemo(
    () =>
      deriveBalanceSheet(STATEMENT_ENTRIES, {
        taxonomy: STATEMENT_TAXONOMY,
        dates: BALANCE_SHEET_DATES,
      }),
    []
  );

  return (
    <div className="space-y-4">
      <div className="demo-container">
        <BalanceSheet data={data} />
      </div>
      <Footnote>
        Retained and current-year earnings are computed at derivation time — no
        closing entries exist in the ledger. The RM&nbsp;500.00 equation
        difference is the suspense account&rsquo;s unclassified balance,
        reported honestly instead of plugged.
      </Footnote>
    </div>
  );
}
