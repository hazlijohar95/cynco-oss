import type { LedgerEntry } from '../types';
import { areEntriesEqual } from './areEntriesEqual';

// Structural equality for an EntryDiff's (before, after) input pair, the
// areEntriesEqual-style fast path that lets the component skip re-diffing
// and re-rendering when a caller passes fresh-but-identical objects (common
// with immutable stores and React re-renders).
export function areEntryDiffInputsEqual(
  previousBefore: LedgerEntry | null | undefined,
  previousAfter: LedgerEntry | null | undefined,
  nextBefore: LedgerEntry | null,
  nextAfter: LedgerEntry | null
): boolean {
  return (
    areNullableEntriesEqual(previousBefore ?? null, nextBefore) &&
    areNullableEntriesEqual(previousAfter ?? null, nextAfter)
  );
}

function areNullableEntriesEqual(
  a: LedgerEntry | null,
  b: LedgerEntry | null
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return areEntriesEqual(a, b);
}
