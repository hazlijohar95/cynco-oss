import type {
  BookPostingRef,
  ReconciliationMatch,
  StatementLine,
} from '../types';

export interface ProposeMatchesOptions {
  /**
   * Maximum |book date − statement date| in days for the suggestion and sum
   * passes. Default 3. Pass 0 to disable both and keep only exact matches.
   */
  dateWindowDays?: number;
  /**
   * Maximum number of postings a sum match may group (pass 3). Default 3.
   * Pass 1 (or 0) to disable sum matching entirely.
   */
  maxGroupSize?: number;
  /**
   * Cap on combinations explored per statement line during the sum pass, so
   * pathological inputs (hundreds of same-currency candidates) stay bounded.
   * Search aborts for that line once exceeded. Default 10_000.
   */
  maxSumCombinations?: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;
const DEFAULT_MAX_SUM_COMBINATIONS = 10_000;

interface PostingCandidate {
  ref: BookPostingRef;
  /** Book date in whole days since the epoch (UTC). */
  epochDays: number;
  amount: number;
  currency: string;
  used: boolean;
}

/**
 * Deterministic matching between statement lines and book postings.
 *
 * Pass 1 pairs exact matches (same amount, currency, and date). Pass 2 pairs
 * remaining lines with the nearest-dated remaining posting of the same
 * amount and currency within ±`dateWindowDays`. Pass 3 covers remaining
 * lines with the sum of 2..`maxGroupSize` remaining postings in the same
 * currency, all within the date window (kind `sum`). Every pass visits
 * lines in ascending id order, so when two lines compete for one posting the
 * earlier statement line id wins. Every line and posting is used at most
 * once across all passes.
 *
 * The sum pass is a bounded depth-first search over candidates ordered by
 * (date distance, amount desc, entry id): the first combination found under
 * that ordering wins, suffix max/min sums prune impossible branches, and at
 * most `maxSumCombinations` nodes are explored per line — so worst-case cost
 * stays O(lines × cap) regardless of how adversarial the amounts are.
 */
export function proposeMatches(
  lines: readonly StatementLine[],
  postings: readonly BookPostingRef[],
  options: ProposeMatchesOptions = {}
): ReconciliationMatch[] {
  const {
    dateWindowDays = 3,
    maxGroupSize = 3,
    maxSumCombinations = DEFAULT_MAX_SUM_COMBINATIONS,
  } = options;

  // Bucket candidates by `${currency}:${amount}` and sort each bucket by
  // date once, so per-line lookups are a binary search plus a bounded
  // outward walk — O(n log n) overall instead of rescanning all postings
  // per line.
  const buckets = new Map<string, PostingCandidate[]>();
  const allCandidates: PostingCandidate[] = [];
  for (const ref of postings) {
    const posting = ref.entry.postings[ref.postingIndex];
    if (posting == null) {
      continue;
    }
    const epochDays = toEpochDays(ref.entry.date);
    if (epochDays == null) {
      continue;
    }
    const candidate: PostingCandidate = {
      ref,
      epochDays,
      amount: posting.amount,
      currency: posting.currency,
      used: false,
    };
    allCandidates.push(candidate);
    const key = `${posting.currency}:${posting.amount}`;
    let bucket = buckets.get(key);
    if (bucket == null) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(candidate);
  }
  for (const bucket of buckets.values()) {
    sortCandidatesByDate(bucket);
  }

  // Lines are visited in ascending id order in every pass: the documented
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
      matchByLineId.set(
        line.id,
        createMatch(line, [candidate.candidate.ref], 'exact', 0)
      );
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
      const taken = takeNearestCandidate(
        buckets.get(`${line.currency}:${line.amount}`),
        lineDays,
        dateWindowDays
      );
      if (taken != null) {
        matchByLineId.set(
          line.id,
          createMatch(line, [taken.candidate.ref], 'suggested', taken.dateDelta)
        );
      }
    }
  }

  // Pass 3: sum matching over whatever is still unmatched on both sides.
  if (dateWindowDays > 0 && maxGroupSize >= 2) {
    for (const line of orderedLines) {
      if (matchByLineId.has(line.id)) {
        continue;
      }
      const lineDays = toEpochDays(line.date);
      if (lineDays == null) {
        continue;
      }
      const group = findSumGroup({
        line,
        lineDays,
        candidates: allCandidates,
        dateWindowDays,
        maxGroupSize,
        maxSumCombinations,
      });
      if (group != null) {
        for (const candidate of group) {
          candidate.used = true;
        }
        matchByLineId.set(
          line.id,
          createMatch(
            line,
            group.map((candidate) => candidate.ref),
            'sum',
            getLargestMagnitudeDelta(group, lineDays)
          )
        );
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

interface FindSumGroupProps {
  line: StatementLine;
  lineDays: number;
  candidates: readonly PostingCandidate[];
  dateWindowDays: number;
  maxGroupSize: number;
  maxSumCombinations: number;
}

// Sum pass for one line: bounded DFS over the eligible (unused, same
// currency, in-window) candidates for a 2..maxGroupSize subset summing to
// the line amount. Candidates are ordered by (date distance, amount desc,
// entry id, posting index) so the first solution — and therefore the result
// — is deterministic. Suffix max/min partial sums prune branches that can no
// longer reach the target, and a node cap bounds the worst case.
function findSumGroup({
  line,
  lineDays,
  candidates,
  dateWindowDays,
  maxGroupSize,
  maxSumCombinations,
}: FindSumGroupProps): PostingCandidate[] | null {
  const eligible = candidates.filter(
    (candidate) =>
      !candidate.used &&
      candidate.currency === line.currency &&
      Math.abs(candidate.epochDays - lineDays) <= dateWindowDays
  );
  if (eligible.length < 2) {
    return null;
  }
  eligible.sort((a, b) => {
    const byDistance =
      Math.abs(a.epochDays - lineDays) - Math.abs(b.epochDays - lineDays);
    if (byDistance !== 0) {
      return byDistance;
    }
    if (a.amount !== b.amount) {
      return b.amount - a.amount;
    }
    const byEntryId = compareStrings(a.ref.entry.id, b.ref.entry.id);
    if (byEntryId !== 0) {
      return byEntryId;
    }
    return a.ref.postingIndex - b.ref.postingIndex;
  });

  // suffixMax[r][i] / suffixMin[r][i]: the largest / smallest sum achievable
  // by picking exactly up-to r candidates from eligible[i..]. Amounts are
  // signed (mixed debits/credits), so both bounds are needed to prune.
  const { suffixMax, suffixMin } = computeSuffixSumBounds(
    eligible,
    maxGroupSize
  );

  const chosen: PostingCandidate[] = [];
  let explored = 0;

  const search = (
    startIndex: number,
    sum: number
  ): PostingCandidate[] | null => {
    const slotsLeft = maxGroupSize - chosen.length;
    if (chosen.length >= 2 && sum === line.amount) {
      return [...chosen];
    }
    if (slotsLeft === 0 || startIndex >= eligible.length) {
      return null;
    }
    const need = line.amount - sum;
    // Prune: even the best/worst remaining combination cannot reach target.
    if (
      need > suffixMax[slotsLeft][startIndex] ||
      need < suffixMin[slotsLeft][startIndex]
    ) {
      return null;
    }
    for (let i = startIndex; i < eligible.length; i += 1) {
      explored += 1;
      if (explored > maxSumCombinations) {
        return null;
      }
      chosen.push(eligible[i]);
      const found = search(i + 1, sum + eligible[i].amount);
      chosen.pop();
      if (found != null) {
        return found;
      }
      if (explored > maxSumCombinations) {
        return null;
      }
    }
    return null;
  };

  return search(0, 0);
}

interface SuffixSumBounds {
  suffixMax: number[][];
  suffixMin: number[][];
}

// Dynamic-programming bounds for the DFS prune: choosing at most r items
// from the suffix starting at i, what is the max/min achievable sum? O(n·k).
function computeSuffixSumBounds(
  eligible: readonly PostingCandidate[],
  maxGroupSize: number
): SuffixSumBounds {
  const count = eligible.length;
  const suffixMax: number[][] = [];
  const suffixMin: number[][] = [];
  for (let r = 0; r <= maxGroupSize; r += 1) {
    suffixMax.push(new Array<number>(count + 1).fill(0));
    suffixMin.push(new Array<number>(count + 1).fill(0));
  }
  for (let r = 1; r <= maxGroupSize; r += 1) {
    for (let i = count - 1; i >= 0; i -= 1) {
      const take = eligible[i].amount;
      suffixMax[r][i] = Math.max(
        suffixMax[r][i + 1],
        take + suffixMax[r - 1][i + 1]
      );
      suffixMin[r][i] = Math.min(
        suffixMin[r][i + 1],
        take + suffixMin[r - 1][i + 1]
      );
    }
  }
  return { suffixMax, suffixMin };
}

function getLargestMagnitudeDelta(
  group: readonly PostingCandidate[],
  lineDays: number
): number {
  let worst = 0;
  for (const candidate of group) {
    const delta = candidate.epochDays - lineDays;
    if (Math.abs(delta) > Math.abs(worst)) {
      worst = delta;
    }
  }
  return worst;
}

function createMatch(
  line: StatementLine,
  refs: readonly BookPostingRef[],
  kind: ReconciliationMatch['kind'],
  dateDelta: number
): ReconciliationMatch {
  const suffix = refs
    .map((ref) => `${ref.entry.id}-${ref.postingIndex}`)
    .join('+');
  return {
    id: `m-${line.id}-${suffix}`,
    statementLineId: line.id,
    postings: refs,
    kind,
    status: 'proposed',
    dateDelta,
  };
}

function sortCandidatesByDate(bucket: PostingCandidate[]): void {
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
