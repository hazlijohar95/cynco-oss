// Pure unit tests for the middle-truncation math, independent of the DOM
// measurement pass in AccountTree. The focus here is Unicode correctness:
// slicing must land on whole code points so astral characters (emoji,
// extended CJK) are never split into lone surrogates.

import { describe, expect, test } from 'bun:test';

import { computeMiddleTruncation } from '../src/render/computeMiddleTruncation';

// A lone surrogate stringifies through this range check; if any slice split a
// surrogate pair the result would contain an unpaired 0xD800–0xDFFF unit.
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate must be followed by a low surrogate.
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate with no preceding high surrogate.
      return true;
    }
  }
  return false;
}

describe('computeMiddleTruncation', () => {
  test('returns null when the text already fits', () => {
    expect(computeMiddleTruncation('Assets:Cash', 100, 200)).toBeNull();
  });

  test('truncates ASCII from the middle, keeping the tail', () => {
    const out = computeMiddleTruncation(
      'Assets:Current:Cash-Maybank',
      270,
      120
    );
    expect(out).not.toBeNull();
    expect(out?.includes('…')).toBe(true);
    // Tail-priority: the end of the string survives.
    expect(out?.endsWith('k')).toBe(true);
  });

  test('never splits an astral character into a lone surrogate', () => {
    // Each emoji is a surrogate pair (2 UTF-16 code units). A code-unit slice
    // would split one; a code-point slice keeps them whole.
    const text = '💰💵💴💶💷🪙🏦💳💸🤑';
    for (let available = 10; available <= 90; available += 7) {
      const out = computeMiddleTruncation(text, 200, available);
      if (out != null) {
        expect(hasLoneSurrogate(out)).toBe(false);
      }
    }
  });

  test('degenerate widths keep a whole last code point, not half a surrogate', () => {
    const text = 'aaaaaaaa💰';
    // Force the budget < 2 branch with a tiny available width.
    const out = computeMiddleTruncation(text, 500, 3);
    expect(out).not.toBeNull();
    expect(hasLoneSurrogate(out as string)).toBe(false);
    // The kept tail character is the whole emoji, not a broken half.
    expect(out).toBe('…💰');
  });

  test('extended CJK (astral) names truncate without mojibake', () => {
    // U+20000-range ideographs are surrogate pairs in UTF-16.
    const text = '資産:𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇:現金';
    const out = computeMiddleTruncation(text, 300, 90);
    if (out != null) {
      expect(hasLoneSurrogate(out)).toBe(false);
    }
  });
});
