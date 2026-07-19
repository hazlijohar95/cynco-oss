import type { RegisterRowData } from '../types';

/**
 * Lowercase search corpus for one register's rows, indexed by entry index.
 * `description[i]` is `payee + '\n' + narration` lowercased (the EntryStore
 * corpus idiom): the newline separator means a query can never accidentally
 * match across the payee/narration boundary. Date and flag need no corpus —
 * ISO dates and flag words are already lowercase.
 */
export interface RegisterFilterCorpus {
  description: readonly string[];
}

// One O(n) lowercase pass per data version. The client Register builds this
// lazily on the FIRST filter application and reuses it across query changes
// (typing refines the query far more often than the rows change), dropping
// it on setRows; the pure worker/SSR matcher builds a throwaway one so both
// paths run the exact same match test.
export function buildRegisterFilterCorpus(
  rows: readonly RegisterRowData[]
): RegisterFilterCorpus {
  const description = rows.map((row) =>
    `${row.entry.payee ?? ''}\n${row.entry.narration}`.toLowerCase()
  );
  return { description };
}
