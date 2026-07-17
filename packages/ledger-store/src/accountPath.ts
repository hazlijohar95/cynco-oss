// Canonical colon-delimited account path helpers. Account paths are the only
// account identity that crosses the package boundary (numeric node ids stay
// internal to AccountStore), so every consumer shares these parsers.
//
// All helpers degrade gracefully: invalid input returns false/null/empty
// instead of throwing, because paths frequently arrive from user-authored
// ledger data that the store must ingest without crashing.

const COLON_CHAR_CODE = 58;

/**
 * True when `path` is a canonical account path: non-empty, colon-delimited,
 * with no leading, trailing, or doubled colons. Segment content is otherwise
 * unrestricted (unicode names like `Expenses:Makan` are valid); the
 * Assets/Liabilities/Equity/Income/Expenses top-level convention is not
 * enforced here.
 */
export function isValidAccountPath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  // Leading/trailing/double colons all reduce to "some segment is empty",
  // detectable in one pass by watching for adjacent delimiters.
  let previousWasColon = true; // treat position -1 as a delimiter → catches leading colon
  for (let index = 0; index < path.length; index += 1) {
    const isColon = path.charCodeAt(index) === COLON_CHAR_CODE;
    if (isColon && previousWasColon) {
      return false;
    }
    previousWasColon = isColon;
  }
  // A trailing colon leaves previousWasColon true after the loop.
  return !previousWasColon;
}

/**
 * Splits a canonical path into its segments:
 * `Assets:Current:Cash` → `['Assets', 'Current', 'Cash']`.
 * Returns an empty array for invalid paths.
 */
export function getAccountSegments(path: string): string[] {
  if (!isValidAccountPath(path)) {
    return [];
  }
  return path.split(':');
}

/**
 * Parent path of a canonical account path
 * (`Assets:Current:Cash` → `Assets:Current`). Returns null for top-level
 * accounts (`Assets`) and for invalid paths.
 */
export function getParentAccountPath(path: string): string | null {
  if (!isValidAccountPath(path)) {
    return null;
  }
  const lastColonIndex = path.lastIndexOf(':');
  if (lastColonIndex < 0) {
    return null;
  }
  return path.slice(0, lastColonIndex);
}

/**
 * Every strict ancestor of a path, nearest the root first:
 * `Assets:Current:Cash` → `['Assets', 'Assets:Current']`. Top-level and
 * invalid paths yield an empty array. Callers building the implied tree for
 * a set of leaf paths iterate this to materialize intermediate group nodes.
 */
export function getAncestorAccountPaths(path: string): string[] {
  if (!isValidAccountPath(path)) {
    return [];
  }
  const ancestors: string[] = [];
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) === COLON_CHAR_CODE) {
      ancestors.push(path.slice(0, index));
    }
  }
  return ancestors;
}

/**
 * Final segment of a canonical path (`Assets:Current:Cash` → `Cash`), used as
 * the display name of a tree row. Returns the empty string for invalid paths.
 */
export function getAccountLeafName(path: string): string {
  if (!isValidAccountPath(path)) {
    return '';
  }
  const lastColonIndex = path.lastIndexOf(':');
  return lastColonIndex < 0 ? path : path.slice(lastColonIndex + 1);
}
