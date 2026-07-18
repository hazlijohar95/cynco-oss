import type {
  BookPostingRef,
  ReconciliationMatch,
  StatementLine,
} from '../types';

export interface ProposeMatchesOptions {
  /**
   * Maximum |book date − statement date| in days for the suggestion pass.
   * Default 3. Pass 0 to disable suggestions and keep only exact matches.
   */
  dateWindowDays?: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

interface PostingCandidate {
  ref: BookPostingRef;
  /** Book date in whole days since the epoch (UTC). */
  epochDays: number;
  used: boolean;
}

/**
 * Deterministic 1:1 matching between statement lines and book postings.
 *
 * Pass 1 pairs exact matches (same amount, currency, and date). Pass 2 pairs
 * remaining lines with the nearest-dated remaining posting of the same
 * amount and currency within ±`dateWindowDays`. Both passes visit lines in
 * ascending id order, so when two lines compete for one posting the earlier
 * statement line id wins; within one line, an equidistant earlier book date
 * beats a later one. Every line and posting is used at most once.
 *
 * Limitation (by design, documented): matching is strictly 1:1 on identical
 * amounts. It never proposes sum matches (one statement line covering
 * several postings, or vice versa) — those stay unmatched for a human to
 * resolve via `onCreateEntry` or a manual match.
 */
export function proposeMatches(
  lines: readonly StatementLine[],
  postings: readonly BookPostingRef[],
  options: ProposeMatchesOptions = {}
): ReconciliationMatch[] {
  const { dateWindowDays = 3 } = options;

  // Bucket candidates by `${currency}:${amount}` and sort each bucket by
  // date once, so per-line lookups are a binary search plus a bounded
  // outward walk — O(n log n) overall instead of rescanning all postings
  // per line.
  const buckets = new Map<string, PostingCandidate[]>();
  for (const ref of postings) {
    const posting = ref.entry.postings[ref.postingIndex];
    if (posting == null) {
      continue;
    }
    const epochDays = toEpochDays(ref.entry.date);
    if (epochDays == null) {
      continue;
    }
    const key = `${posting.currency}:${posting.amount}`;
    let bucket = buckets.get(key);
    if (bucket == null) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push({ ref, epochDays, used: false });
  }
  for (const bucket of buckets.values()) {
    // Date first; entry id + posting index as total tiebreak so bucket order
    // (and therefore matching) never depends on caller array order.
    bucket.sort((a, b) => {
      const byDate = a.epochDays - b.epochDays;
      if (byDate !== 0) {
        return byDate;
      }
      const byEntryId = compareStrings(a.ref.entry.id, b.ref.entry.id);
      if (byEntryId !== 0) {
        return byEntryId;
      }
      return a.ref.postingIndex - b.ref.postingIndex;
    });
  }

  // Lines are visited in ascending id order in both passes: the documented
  // "earlier statement line id wins" tiebreak for contested postings.
  const orderedLines = [...lines].sort((a, b) => compareStrings(a.id, b.id));
  const matchByLineId = new Map<string, ReconciliationMatch>();

  // Pass 1: exact (amount + currency + same date).
  for (const line of orderedLines) {
    const lineDays = toEpochDays(line.date);
    if (lineDays == null) {
      continue;
    }
    const candidate = takeNearestCandidate(
      buckets.get(`${line.currency}:${line.amount}`),
      lineDays,
      0
    );
    if (candidate != null) {
      matchByLineId.set(line.id, createMatch(line, candidate, 'exact'));
    }
  }

  // Pass 2: same amount + currency within the window, nearest date wins.
  if (dateWindowDays > 0) {
    for (const line of orderedLines) {
      if (matchByLineId.has(line.id)) {
        continue;
      }
      const lineDays = toEpochDays(line.date);
      if (lineDays == null) {
        continue;
      }
      const candidate = takeNearestCandidate(
        buckets.get(`${line.currency}:${line.amount}`),
        lineDays,
        dateWindowDays
      );
      if (candidate != null) {
        matchByLineId.set(line.id, createMatch(line, candidate, 'suggested'));
      }
    }
  }

  // Emit in ascending line-id order — stable regardless of input ordering.
  const matches: ReconciliationMatch[] = [];
  for (const line of orderedLines) {
    const match = matchByLineId.get(line.id);
    if (match != null) {
      matches.push(match);
    }
  }
  return matches;
}

interface TakenCandidate {
  candidate: PostingCandidate;
  dateDelta: number;
}

// Finds and consumes the unused candidate nearest to `targetDays` with
// |delta| <= maxDelta. The bucket is date-sorted, so binary-search the
// insertion point and walk outward left/right, preferring the smaller
// |delta| and, on ties, the earlier book date.
function takeNearestCandidate(
  bucket: PostingCandidate[] | undefined,
  targetDays: number,
  maxDelta: number
): TakenCandidate | null {
  if (bucket == null || bucket.length === 0) {
    return null;
  }
  // Lower bound: first index with epochDays >= targetDays.
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (bucket[mid].epochDays < targetDays) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  let left = low - 1;
  let right = low;
  let best: PostingCandidate | null = null;
  let bestDistance = maxDelta + 1;
  // Walk outward, skipping used candidates. The `used` skips keep total work
  // across all lines linear in bucket size (each candidate is consumed once).
  while (left >= 0 || right < bucket.length) {
    const leftDistance =
      left >= 0
        ? targetDays - bucket[left].epochDays
        : Number.POSITIVE_INFINITY;
    const rightDistance =
      right < bucket.length
        ? bucket[right].epochDays - targetDays
        : Number.POSITIVE_INFINITY;
    if (Math.min(leftDistance, rightDistance) >= bestDistance) {
      break;
    }
    // Ties prefer the earlier book date: take the left side when equal.
    if (leftDistance <= rightDistance) {
      if (!bucket[left].used && leftDistance < bestDistance) {
        best = bucket[left];
        bestDistance = leftDistance;
      }
      left -= 1;
    } else {
      if (!bucket[right].used && rightDistance < bestDistance) {
        best = bucket[right];
        bestDistance = rightDistance;
      }
      right += 1;
    }
  }
  if (best == null || bestDistance > maxDelta) {
    return null;
  }
  best.used = true;
  return { candidate: best, dateDelta: best.epochDays - targetDays };
}

function createMatch(
  line: StatementLine,
  taken: TakenCandidate,
  kind: ReconciliationMatch['kind']
): ReconciliationMatch {
  const { ref } = taken.candidate;
  return {
    id: `m-${line.id}-${ref.entry.id}-${ref.postingIndex}`,
    statementLineId: line.id,
    posting: ref,
    kind,
    status: 'proposed',
    dateDelta: taken.dateDelta,
  };
}

// ISO dates parse as UTC midnight, so integer division by a day is exact.
// Malformed dates return null and the row simply never auto-matches
// (graceful degradation, never a throw mid-render).
function toEpochDays(isoDate: string): number | null {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / MILLISECONDS_PER_DAY);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
