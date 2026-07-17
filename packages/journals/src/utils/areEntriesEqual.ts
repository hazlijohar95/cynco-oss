import type { LedgerEntry, Posting } from '../types';

// Structural equality for entries so components can skip re-rendering when a
// caller passes a fresh-but-identical object (common with immutable stores).
// Compares by value, not reference, because SSR-hydrated instances never
// share references with client data.
export function areEntriesEqual(
  a: LedgerEntry | undefined,
  b: LedgerEntry | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return (
    a.id === b.id &&
    a.date === b.date &&
    a.flag === b.flag &&
    a.payee === b.payee &&
    a.narration === b.narration &&
    areStringArraysEqual(a.tags, b.tags) &&
    areStringArraysEqual(a.links, b.links) &&
    arePostingListsEqual(a.postings, b.postings)
  );
}

function areStringArraysEqual(
  a: readonly string[],
  b: readonly string[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function arePostingListsEqual(
  a: readonly Posting[],
  b: readonly Posting[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.account !== right.account ||
      left.amount !== right.amount ||
      left.currency !== right.currency
    ) {
      return false;
    }
  }
  return true;
}
