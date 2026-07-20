// Pure middle-truncation math for measured account names. Separated from the
// DOM pass in AccountTree so the sizing policy is testable without layout:
// the view feeds in measured pixel widths, this decides what text survives.

/**
 * Computes the middle-truncated form of `fullText` for an element whose
 * untruncated text measures `fullWidth` px inside `availableWidth` px, or
 * null when the text already fits (callers must then leave the DOM alone —
 * no writes for non-overflowing rows).
 *
 * The character budget is a proportional estimate (`availableWidth` divided
 * by the text's average character width) rather than a per-character DOM
 * measure loop; the view's pass corrects residual overflow with a couple of
 * batched re-measures. End-priority split: account names distinguish at the
 * END (`…rent : Cash-Maybank`, `…s : Sales : Online`) far more than at the
 * start, so the tail keeps ~3/4 of the budget and characters drop from the
 * middle-left behind a single ellipsis.
 */
export function computeMiddleTruncation(
  fullText: string,
  fullWidth: number,
  availableWidth: number
): string | null {
  // Slicing must be by Unicode code point, not by UTF-16 code unit:
  // `.length` and `.slice` count code units, so a raw slice through an astral
  // character (emoji, extended CJK) would split a surrogate pair and emit a
  // replacement glyph. `Array.from` iterates by code point, so every slice
  // boundary lands between whole characters. (Combining marks / full grapheme
  // clusters are a deeper problem not solved here, but surrogate splitting —
  // the source of visible mojibake — is.)
  const chars = Array.from(fullText);
  const charCount = chars.length;
  if (
    fullWidth <= availableWidth ||
    availableWidth <= 0 ||
    fullWidth <= 0 ||
    charCount < 3
  ) {
    return null;
  }
  const averageCharWidth = fullWidth / charCount;
  // One character of budget pays for the ellipsis itself.
  const budget = Math.floor(availableWidth / averageCharWidth) - 1;
  if (budget >= charCount) {
    return null;
  }
  if (budget < 2) {
    // Degenerate widths: keep the last character so the row never renders
    // a bare ellipsis with nothing identifying.
    return `…${chars[charCount - 1]}`;
  }
  const headLength = Math.max(1, Math.floor(budget / 4));
  const tailLength = budget - headLength;
  return `${chars.slice(0, headLength).join('')}…${chars.slice(charCount - tailLength).join('')}`;
}
