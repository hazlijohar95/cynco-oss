'use client';

import {
  formatMinorUnits,
  proposeMatches,
  Reconciliation as ReconciliationComponent,
  type ReconciliationMatch,
  type ReconciliationOptions,
} from '@cynco/journals';
import { useJournalsInstance } from '@cynco/journals/react';
import { CheckCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import {
  RECONCILIATION_ACCOUNT,
  RECONCILIATION_PERIOD,
  RECONCILIATION_POSTINGS,
  RECONCILIATION_STATEMENT_LINES,
} from './reconciliation';
import { Footnote } from '@/components/Footnote';
import { Button } from '@/components/ui/button';

// Formats the per-currency difference map from getState() as a compact
// mono-friendly string, e.g. `−1,240.00 MYR`.
function formatDifference(difference: Map<string, number>): string {
  const parts: string[] = [];
  for (const [currency, amount] of difference) {
    parts.push(`${formatMinorUnits(amount, currency)} ${currency}`);
  }
  return parts.length === 0 ? '0' : parts.join(' · ');
}

export interface ReconciliationDemoProps {
  /**
   * Whether the footnote links to the matching-engine docs. The landing
   * page keeps the default; the docs page embeds this demo inside that very
   * section, where a self-link would be noise.
   */
  docsLink?: boolean;
}

// Interactive reconciliation demo built on the vanilla class through the
// shared instance hook (the plain React wrapper exposes no imperative
// surface, and the control bar needs acceptMatch/setOptions). The component
// owns match state; the page listens and narrates.
export function ReconciliationDemo({
  docsLink = true,
}: ReconciliationDemoProps = {}) {
  // The journals instance hook (unlike the accounts one) exposes no
  // getInstance, so the demo captures the vanilla instance itself in
  // create() — the control bar needs acceptMatch/getState/setOptions.
  const instanceRef = useRef<ReconciliationComponent | null>(null);
  const getInstance = () => instanceRef.current;
  const [readout, setReadout] = useState(
    'Hover or tap a matched pair to accept or reject it, or accept every exact match at once.'
  );

  const describe = (verb: string, match: ReconciliationMatch) => {
    const instance = getInstance();
    // Sum matches group several postings; the first one names the pair and
    // the amounts are summed for the narration.
    const first = match.postings[0];
    const posting = first?.entry.postings[first.postingIndex];
    let total = 0;
    for (const ref of match.postings) {
      total += ref.entry.postings[ref.postingIndex]?.amount ?? 0;
    }
    const amount =
      posting == null
        ? ''
        : ` (${formatMinorUnits(total, posting.currency, { sign: 'always' })} ${posting.currency})`;
    const difference =
      instance == null
        ? ''
        : ` — difference now ${formatDifference(instance.getState().difference)}`;
    setReadout(
      `${verb} ${match.kind} match for ${first?.entry.payee ?? first?.entry.narration ?? match.statementLineId}${amount}${difference}.`
    );
  };

  const baseOptions: ReconciliationOptions = {
    account: RECONCILIATION_ACCOUNT,
    periodLabel: RECONCILIATION_PERIOD,
    statementLines: RECONCILIATION_STATEMENT_LINES,
    postings: RECONCILIATION_POSTINGS,
    onAccept: (match) => describe('Accepted', match),
    onReject: (match) => describe('Rejected', match),
    onUndo: (match) => describe('Reverted', match),
    onCreateEntry: (line) =>
      setReadout(
        `Create-entry requested for "${line.description}" — the component only emits the callback.`
      ),
  };

  const { ref } = useJournalsInstance<ReconciliationComponent>({
    create(container) {
      const instance = new ReconciliationComponent(baseOptions, true);
      instance.hydrate({ container });
      instanceRef.current = instance;
      return instance;
    },
    update(instance) {
      // Same statementLines/postings references and no `matches` key, so
      // in-flight accept/reject state survives every React render.
      instance.setOptions(baseOptions);
    },
    destroy(instance) {
      instance.cleanUp();
      instanceRef.current = null;
    },
  });

  const acceptExactMatches = () => {
    const instance = getInstance();
    if (instance == null) return;
    const exact = instance
      .getState()
      .matches.filter(
        (match) => match.kind === 'exact' && match.status === 'proposed'
      );
    for (const match of exact) {
      instance.acceptMatch(match.id);
    }
    const { difference } = instance.getState();
    setReadout(
      exact.length === 0
        ? 'No proposed exact matches left to accept.'
        : `Accepted ${exact.length} exact match${exact.length === 1 ? '' : 'es'} — difference now ${formatDifference(difference)}.`
    );
  };

  const reset = () => {
    const instance = getInstance();
    if (instance == null) return;
    // Passing an explicit match list re-derives state; re-proposing from
    // the same data returns every pair to `proposed`.
    instance.setOptions({
      ...baseOptions,
      matches: proposeMatches(
        RECONCILIATION_STATEMENT_LINES,
        RECONCILIATION_POSTINGS
      ),
    });
    setReadout(
      `Reset — difference back to ${formatDifference(instance.getState().difference)}.`
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground font-normal"
          onClick={acceptExactMatches}
        >
          <CheckCheck size={16} />
          Accept exact matches
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground font-normal"
          onClick={reset}
        >
          <RotateCcw size={16} />
          Reset
        </Button>
      </div>

      <div className="demo-container">
        <journals-container ref={ref} />
      </div>
      <Footnote>
        <span data-reconciliation-readout>{readout}</span> Matching is
        deterministic — exact 1:1 pairs plus bounded sum matches
        {docsLink ? (
          <>
            {' — '}
            <Link
              href="/docs/journals#reconciliation"
              className="footnote-link"
            >
              read the matching engine docs
            </Link>
          </>
        ) : null}
        .
      </Footnote>
    </div>
  );
}
