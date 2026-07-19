// Synthetic projection-row identity for child-load placeholder rows (the
// spinner / error rows shown under an expanded loading/error group). These
// rows are VIEW rows, not store rows: they occupy one fixed-height slot in
// the visible projection (so windowing math stays untouched) but name no
// account. Their identity string is deliberately NOT a valid canonical path
// — it embeds U+0000, which no user-authored path can contain — so every
// store lookup (`hasAccount`, `getPathIndex`, selection) degrades to the
// graceful "unknown path" no-op automatically, and only code that opts in
// via these helpers ever treats them specially.

const PLACEHOLDER_PREFIX = '\u0000child-load\u0000';

/** Projection identity for the placeholder row under `parentPath`. */
export function makeChildLoadPlaceholderPath(parentPath: string): string {
  return PLACEHOLDER_PREFIX + parentPath;
}

/**
 * The loading/error group a placeholder row belongs to, or null when the
 * value is an ordinary canonical account path.
 */
export function getChildLoadPlaceholderParent(value: string): string | null {
  return value.startsWith(PLACEHOLDER_PREFIX)
    ? value.slice(PLACEHOLDER_PREFIX.length)
    : null;
}

/** True when the projection value names a placeholder row, not an account. */
export function isChildLoadPlaceholderPath(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX);
}
