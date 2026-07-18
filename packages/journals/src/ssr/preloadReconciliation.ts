import { renderReconciliationHTML } from '../renderers/ReconciliationRenderer';
import styles from '../style.css?inline';
import type {
  BookPostingRef,
  ReconciliationMatch,
  StatementLine,
} from '../types';
import { proposeMatches } from '../utils/proposeMatches';

export interface PreloadReconciliationOptions {
  /** Canonical colon-delimited path of the account being reconciled. */
  account: string;
  /** Optional period caption shown next to the account, e.g. `Jul 2026`. */
  periodLabel?: string;
  statementLines: readonly StatementLine[];
  postings: readonly BookPostingRef[];
  /** Match set to render; defaults to `proposeMatches` over the data. */
  matches?: readonly ReconciliationMatch[];
  /** Suggestion window forwarded to the default `proposeMatches`. Default 3. */
  dateWindowDays?: number;
}

// Produces the shadow-root HTML for a reconciliation view, ready for a
// declarative shadow DOM template. The same ReconciliationRenderer string
// builder powers the client render, so hydration adopts this DOM verbatim.
// The matching engine is deterministic, so server and client derive the
// identical proposal set from the same data.
export function preloadReconciliationHTML(
  options: PreloadReconciliationOptions
): Promise<string> {
  const matches =
    options.matches ??
    proposeMatches(options.statementLines, options.postings, {
      dateWindowDays: options.dateWindowDays,
    });
  return Promise.resolve(
    `<style>${styles}</style>` +
      renderReconciliationHTML({
        account: options.account,
        periodLabel: options.periodLabel ?? null,
        lines: options.statementLines,
        postings: options.postings,
        matches,
      })
  );
}
