import type {
  EntryFieldDiff,
  EntryListDiff,
  EntryListItemDiff,
  EntryVersionDiff,
  EntryVersionDiffKind,
  LedgerEntry,
  Posting,
  PostingDiff,
} from '../types';
import { areEntriesEqual } from './areEntriesEqual';
import { diffWords } from './diffWords';

// Computes the full diff between two versions of a journal entry — the
// audit-trail analog of diffing a file. Pure data in, pure data out (no DOM,
// no formatting) so the same function serves the client renderer, SSR, and
// tests. `before: null` models entry creation (everything added);
// `after: null` models deletion/void (everything removed).
export function diffEntryVersions(
  before: LedgerEntry | null,
  after: LedgerEntry | null
): EntryVersionDiff {
  return {
    kind: classifyVersions(before, after),
    before,
    after,
    date: diffStringField(before?.date ?? null, after?.date ?? null, false),
    flag: diffStringField(before?.flag ?? null, after?.flag ?? null, false),
    payee: diffStringField(before?.payee ?? null, after?.payee ?? null, true),
    narration: diffStringField(
      before?.narration ?? null,
      after?.narration ?? null,
      true
    ),
    tags: diffStringList(before?.tags ?? null, after?.tags ?? null),
    links: diffStringList(before?.links ?? null, after?.links ?? null),
    postings: diffPostings(before?.postings ?? null, after?.postings ?? null),
  };
}

function classifyVersions(
  before: LedgerEntry | null,
  after: LedgerEntry | null
): EntryVersionDiffKind {
  if (before == null && after == null) {
    // Degenerate input; classify as unchanged so renderers degrade to an
    // empty card instead of throwing.
    return 'unchanged';
  }
  if (before == null) {
    return 'created';
  }
  if (after == null) {
    return 'deleted';
  }
  return areEntriesEqual(before, after) ? 'unchanged' : 'modified';
}

// Scalar header field diff. Empty strings are treated as absent (matching
// EntryRenderer, which omits empty payee/narration spans entirely), so
// '' -> 'text' classifies as added, not changed. Word-level segments are
// only computed for changed prose fields (payee/narration); when diffWords
// hits its length cap the segments stay null and the whole field renders
// changed.
function diffStringField(
  before: string | null,
  after: string | null,
  wordLevel: boolean
): EntryFieldDiff {
  const beforeValue = before == null || before === '' ? null : before;
  const afterValue = after == null || after === '' ? null : after;
  if (beforeValue == null && afterValue == null) {
    return emptyFieldDiff('unchanged');
  }
  if (beforeValue == null) {
    return { ...emptyFieldDiff('added'), after: afterValue };
  }
  if (afterValue == null) {
    return { ...emptyFieldDiff('removed'), before: beforeValue };
  }
  if (beforeValue === afterValue) {
    return {
      ...emptyFieldDiff('unchanged'),
      before: beforeValue,
      after: afterValue,
    };
  }
  const words = wordLevel ? diffWords(beforeValue, afterValue) : null;
  return {
    kind: 'changed',
    before: beforeValue,
    after: afterValue,
    beforeSegments: words?.before ?? null,
    afterSegments: words?.after ?? null,
  };
}

function emptyFieldDiff(kind: EntryFieldDiff['kind']): EntryFieldDiff {
  return {
    kind,
    before: null,
    after: null,
    beforeSegments: null,
    afterSegments: null,
  };
}

// Tag/link list diff by membership (tags are sets semantically, so position
// changes are not changes). Deterministic ordering: after-side items in
// after order, then removed before-side items appended in before order.
function diffStringList(
  before: readonly string[] | null,
  after: readonly string[] | null
): EntryListDiff {
  const beforeItems = before ?? [];
  const afterItems = after ?? [];
  const beforeSet = new Set(beforeItems);
  const afterSet = new Set(afterItems);
  const items: EntryListItemDiff[] = [];
  for (const value of afterItems) {
    items.push({
      value,
      kind: before != null && beforeSet.has(value) ? 'unchanged' : 'added',
    });
  }
  for (const value of beforeItems) {
    if (after == null || !afterSet.has(value)) {
      items.push({ value, kind: 'removed' });
    }
  }
  if (before == null) {
    return { kind: afterItems.length > 0 ? 'added' : 'unchanged', items };
  }
  if (after == null) {
    return { kind: beforeItems.length > 0 ? 'removed' : 'unchanged', items };
  }
  const changed = items.some((item) => item.kind !== 'unchanged');
  return { kind: changed ? 'changed' : 'unchanged', items };
}

// Aligns postings between versions by (account, currency) pairs with a
// stable greedy strategy:
//   1. exact matches (account + currency + amount) pair first,
//   2. leftover same-(account, currency) postings pair as `amount-changed`,
//   3. remaining before-postings are `removed`, remaining after-postings
//      `added`.
// Tie-breaking is deterministic: within one (account, currency) key,
// candidates pair in input order (first unmatched before-posting wins), so
// duplicate account+currency pairs align positionally. Output order is the
// after entry's posting order, then removed postings appended in before
// order — a diff reads top-down as "what the entry looks like now, plus
// what was taken away".
function diffPostings(
  before: readonly Posting[] | null,
  after: readonly Posting[] | null
): PostingDiff[] {
  const beforePostings = before ?? [];
  const afterPostings = after ?? [];
  const beforeMatched = new Array<boolean>(beforePostings.length).fill(false);
  // For each after posting, the aligned before-posting index (or null).
  const alignedBeforeIndex = new Array<number | null>(
    afterPostings.length
  ).fill(null);

  // Queue of unmatched before-posting indexes per (account, currency) key,
  // consumed front-first so alignment is stable and O(n) overall.
  const beforeIndexesByKey = new Map<string, number[]>();
  for (const [index, posting] of beforePostings.entries()) {
    const key = postingKey(posting);
    const queue = beforeIndexesByKey.get(key);
    if (queue == null) {
      beforeIndexesByKey.set(key, [index]);
    } else {
      queue.push(index);
    }
  }

  // Pass 1: exact (account + currency + amount) matches.
  for (const [afterIndex, posting] of afterPostings.entries()) {
    const queue = beforeIndexesByKey.get(postingKey(posting));
    if (queue == null) {
      continue;
    }
    const queueIndex = queue.findIndex(
      (beforeIndex) =>
        !beforeMatched[beforeIndex] &&
        beforePostings[beforeIndex].amount === posting.amount
    );
    if (queueIndex !== -1) {
      const beforeIndex = queue[queueIndex];
      beforeMatched[beforeIndex] = true;
      alignedBeforeIndex[afterIndex] = beforeIndex;
      queue.splice(queueIndex, 1);
    }
  }

  // Pass 2: remaining same-key postings pair as amount-changed.
  for (const [afterIndex, posting] of afterPostings.entries()) {
    if (alignedBeforeIndex[afterIndex] != null) {
      continue;
    }
    const queue = beforeIndexesByKey.get(postingKey(posting));
    if (queue == null) {
      continue;
    }
    const beforeIndex = queue.shift();
    if (beforeIndex != null) {
      beforeMatched[beforeIndex] = true;
      alignedBeforeIndex[afterIndex] = beforeIndex;
    }
  }

  const diffs: PostingDiff[] = [];
  for (const [afterIndex, posting] of afterPostings.entries()) {
    const beforeIndex = alignedBeforeIndex[afterIndex];
    if (beforeIndex == null) {
      diffs.push({
        kind: 'added',
        account: posting.account,
        currency: posting.currency,
        beforeAmount: null,
        afterAmount: posting.amount,
      });
      continue;
    }
    const beforeAmount = beforePostings[beforeIndex].amount;
    diffs.push({
      kind: beforeAmount === posting.amount ? 'unchanged' : 'amount-changed',
      account: posting.account,
      currency: posting.currency,
      beforeAmount,
      afterAmount: posting.amount,
    });
  }
  for (const [beforeIndex, posting] of beforePostings.entries()) {
    if (!beforeMatched[beforeIndex]) {
      diffs.push({
        kind: 'removed',
        account: posting.account,
        currency: posting.currency,
        beforeAmount: posting.amount,
        afterAmount: null,
      });
    }
  }
  return diffs;
}

// NUL never appears in canonical account paths or currency codes, so it is
// a collision-free join character for the alignment key.
function postingKey(posting: Posting): string {
  return `${posting.account}\u0000${posting.currency}`;
}
