import { MAX_FIELD_DIFF_LENGTH } from '../constants';
import type { WordDiffSegment } from '../types';

export interface WordDiff {
  before: readonly WordDiffSegment[];
  after: readonly WordDiffSegment[];
}

// Word-level diff between two header field strings using the word-alt
// treatment: LCS over word tokens (whitespace preserved
// verbatim), then a join pass that folds a single-space unchanged gap
// between two changed runs into one contiguous highlight so phrase edits
// read as one span instead of per-word confetti. Returns null whenever a
// truthful word-level highlight can't be produced — either side exceeds
// MAX_FIELD_DIFF_LENGTH, or the edit is
// whitespace-only and therefore invisible at word granularity — and callers
// then mark the whole field changed instead.
export function diffWords(before: string, after: string): WordDiff | null {
  if (
    before.length > MAX_FIELD_DIFF_LENGTH ||
    after.length > MAX_FIELD_DIFF_LENGTH
  ) {
    return null;
  }
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  const beforeWords = beforeTokens.filter((token) => !token.whitespace);
  const afterWords = afterTokens.filter((token) => !token.whitespace);
  const { keptBefore, keptAfter } = computeKeptWords(
    beforeWords.map((token) => token.text),
    afterWords.map((token) => token.text)
  );
  const result: WordDiff = {
    before: buildSegments(beforeTokens, keptBefore),
    after: buildSegments(afterTokens, keptAfter),
  };
  // Whitespace tokens never enter the LCS, so a whitespace-only edit
  // ("a b" → "a  b") yields zero changed segments while the strings differ —
  // rendering that as "changed, nothing highlighted" would be a silent lie.
  // Fall back to the whole-field-changed contract instead.
  if (
    before !== after &&
    !result.before.some((segment) => segment.changed) &&
    !result.after.some((segment) => segment.changed)
  ) {
    return null;
  }
  return result;
}

interface Token {
  text: string;
  whitespace: boolean;
}

// Splits into alternating word/whitespace tokens, preserving the exact
// whitespace so re-joining segments reproduces the input byte for byte.
function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  for (const part of value.split(/(\s+)/)) {
    if (part !== '') {
      tokens.push({ text: part, whitespace: /^\s+$/.test(part) });
    }
  }
  return tokens;
}

interface KeptWords {
  keptBefore: boolean[];
  keptAfter: boolean[];
}

// Classic LCS DP over word tokens, then a backtrack marking which words are
// part of the common subsequence (kept) on each side. Inputs are capped at
// MAX_FIELD_DIFF_LENGTH chars, so the table stays small.
function computeKeptWords(
  beforeWords: readonly string[],
  afterWords: readonly string[]
): KeptWords {
  const rows = beforeWords.length;
  const columns = afterWords.length;
  // Flat (rows+1)×(columns+1) table of LCS lengths.
  const table = new Int32Array((rows + 1) * (columns + 1));
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= columns; j += 1) {
      table[i * (columns + 1) + j] =
        beforeWords[i - 1] === afterWords[j - 1]
          ? table[(i - 1) * (columns + 1) + (j - 1)] + 1
          : Math.max(
              table[(i - 1) * (columns + 1) + j],
              table[i * (columns + 1) + (j - 1)]
            );
    }
  }
  const keptBefore = new Array<boolean>(rows).fill(false);
  const keptAfter = new Array<boolean>(columns).fill(false);
  let i = rows;
  let j = columns;
  while (i > 0 && j > 0) {
    if (beforeWords[i - 1] === afterWords[j - 1]) {
      keptBefore[i - 1] = true;
      keptAfter[j - 1] = true;
      i -= 1;
      j -= 1;
    } else if (
      table[(i - 1) * (columns + 1) + j] >= table[i * (columns + 1) + (j - 1)]
    ) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return { keptBefore, keptAfter };
}

// Reassembles one side's tokens into changed/unchanged segments: words carry
// their LCS verdict, whitespace starts unchanged, then the word-alt join
// flips a single-space unchanged gap flanked by changed runs, and finally
// adjacent same-flag runs coalesce.
function buildSegments(
  tokens: readonly Token[],
  keptWords: readonly boolean[]
): WordDiffSegment[] {
  const raw: WordDiffSegment[] = [];
  let wordIndex = 0;
  for (const token of tokens) {
    if (token.whitespace) {
      raw.push({ changed: false, text: token.text });
    } else {
      raw.push({ changed: !keptWords[wordIndex], text: token.text });
      wordIndex += 1;
    }
  }
  // Word-alt join: a lone ' ' between two changed runs becomes changed so
  // the two runs merge into one phrase-level highlight.
  for (let index = 1; index < raw.length - 1; index += 1) {
    const segment = raw[index];
    if (
      !segment.changed &&
      segment.text === ' ' &&
      raw[index - 1].changed &&
      raw[index + 1].changed
    ) {
      segment.changed = true;
    }
  }
  const merged: WordDiffSegment[] = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    if (last != null && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}
