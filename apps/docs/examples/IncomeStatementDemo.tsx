'use client';

import { deriveIncomeStatement } from '@cynco/statements';
import { IncomeStatement } from '@cynco/statements/react';
import { useMemo } from 'react';

import {
  INCOME_STATEMENT_PERIODS,
  STATEMENT_ENTRIES,
  STATEMENT_TAXONOMY,
} from './statementEntries';
import { Footnote } from '@/components/Footnote';

// Live comparative P&L over the fixture ledger: two financial-year columns
// (FY2025 / FY2026), income presentation-flipped so revenue reads positive,
// and the suspense account surfaced as flagged unclassified activity.
export function IncomeStatementDemo() {
  const data = useMemo(
    () =>
      deriveIncomeStatement(STATEMENT_ENTRIES, {
        taxonomy: STATEMENT_TAXONOMY,
        periods: INCOME_STATEMENT_PERIODS,
      }),
    []
  );

  return (
    <div className="space-y-4">
      <div className="demo-container">
        <IncomeStatement data={data} />
      </div>
      <Footnote>
        Each column is the account activity inside its period — never a
        cumulative balance. The unclassified suspense residue is listed but
        excluded from every total.
      </Footnote>
    </div>
  );
}
