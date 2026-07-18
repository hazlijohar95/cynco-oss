'use client';

import { formatMinorUnits, type ReconciliationMatch } from '@cynco/journals';
import { Reconciliation } from '@cynco/journals/react';
import { useState } from 'react';

import {
  RECONCILIATION_ACCOUNT,
  RECONCILIATION_PERIOD,
  RECONCILIATION_POSTINGS,
  RECONCILIATION_STATEMENT_LINES,
} from './reconciliation';

// Interactive reconciliation demo: proposals come from the deterministic
// matching engine; the readout narrates the last action. The component owns
// the accept/reject state — the page only listens.
export function ReconciliationDemo() {
  const [readout, setReadout] = useState(
    'Hover a matched pair to accept or reject it.'
  );

  const describe = (verb: string, match: ReconciliationMatch) => {
    const posting = match.posting.entry.postings[match.posting.postingIndex];
    const amount =
      posting == null
        ? ''
        : ` (${formatMinorUnits(posting.amount, posting.currency, { sign: 'always' })} ${posting.currency})`;
    setReadout(
      `${verb} ${match.kind} match for ${match.posting.entry.payee ?? match.posting.entry.narration}${amount}`
    );
  };

  return (
    <div className="space-y-2">
      <div className="demo-container">
        <Reconciliation
          options={{
            account: RECONCILIATION_ACCOUNT,
            periodLabel: RECONCILIATION_PERIOD,
            statementLines: RECONCILIATION_STATEMENT_LINES,
            postings: RECONCILIATION_POSTINGS,
            onAccept: (match) => describe('Accepted', match),
            onReject: (match) => describe('Rejected', match),
            onUndo: (match) => describe('Undid', match),
            onCreateEntry: (line) =>
              setReadout(
                `Create-entry requested for "${line.description}" — the component only emits the callback.`
              ),
          }}
        />
      </div>
      <p
        className="text-muted-foreground font-mono text-xs"
        data-reconciliation-readout
      >
        {readout}
      </p>
    </div>
  );
}
