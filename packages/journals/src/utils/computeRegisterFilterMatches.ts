import type { RegisterFilter, RegisterRowData } from '../types';
import {
  buildRegisterFilterCorpus,
  type RegisterFilterCorpus,
} from './buildRegisterFilterCorpus';

/** Default filter fields: the description cell is what users scan. */
const DEFAULT_FILTER_FIELDS = ['description'] as const;

// Entry indexes (ascending, FULL-data space) of the rows matching a filter:
// case-insensitive substring on each requested field, a row matching when
// ANY field matches. Deterministic and DOM-free, so the client Register, the
// worker, and SSR all resolve the identical match set from the same inputs —
// the precondition for byte-identical window HTML. Pass the client's cached
// corpus to skip re-lowercasing per keystroke; omitted, a throwaway corpus
// is built (the worker/SSR one-shot path).
export function computeRegisterFilterMatches(
  rows: readonly RegisterRowData[],
  filter: RegisterFilter,
  corpus: RegisterFilterCorpus = buildRegisterFilterCorpus(rows)
): number[] {
  const query = filter.query.toLowerCase();
  const fields = filter.fields ?? DEFAULT_FILTER_FIELDS;
  const matches: number[] = [];
  if (query === '') {
    return matches; // Callers treat empty queries as "no filter" upstream.
  }
  for (const [entryIndex, row] of rows.entries()) {
    let matched = false;
    for (const field of fields) {
      if (field === 'description') {
        matched = corpus.description[entryIndex].includes(query);
      } else if (field === 'date') {
        // ISO dates are already lowercase; substring so `2026-03` works.
        matched = row.entry.date.includes(query);
      } else {
        // Flag words are lowercase constants (`cleared`, `pending`, ...).
        matched = row.entry.flag.includes(query);
      }
      if (matched) {
        break;
      }
    }
    if (matched) {
      matches.push(entryIndex);
    }
  }
  return matches;
}
