/**
 * How a window commit reached the DOM: `replace` is the original wholesale
 * innerHTML write, `morph` the keyed per-row reconciliation. Exposed so
 * tests can assert the fast paths fire where they should.
 */
export type RegisterCommitMode = 'replace' | 'morph';

// Commits a rendered window HTML string into the live rows container with
// KEYED PER-ROW RECONCILIATION instead of a wholesale innerHTML write.
//
// Why: an innerHTML rewrite destroys every row element on every window
// commit, so a row that stays in (or re-enters) the window is a brand-new
// element rendered with its final state — declared CSS transitions can never
// fire, and exit/enter animation is architecturally impossible. Keeping the
// element alive across commits is what lets state changes animate. The
// RENDERED STRING is untouched: SSR, the worker pool, and the sync client
// path keep producing byte-identical HTML (that invariant is load-bearing —
// see renderRegisterWindowHTML); only how the string is committed changes.
//
// Keys come from attributes the renderer already bakes into every row:
// `data-row-index` (the absolute ENTRY index — stable across windows,
// filters, and grouping) for entry rows, `data-group-key` for period group
// header rows. The two live in separate namespaces so an entry index can
// never collide with a group key.
//
// Equality is whole-row `outerHTML` comparison. At window sizes (~viewport +
// 2×overscan rows) that is cheap, and it is exactly the right test: the
// renderer is deterministic, so identical bytes mean identical rows.
// Attribute-level diffing would buy nothing but complexity. Two attributes
// are excluded from the comparison — `data-focused` and `data-hovered` —
// because they are deliberately NOT baked into window HTML: focus is patched
// after every commit (Register.patchFocusAttributes) and hover is patched
// live by the InteractionManager. Without the exclusion the focused/hovered
// row would be the one row that never gets reused — the exact row where
// element continuity matters most. Selection needs no exclusion: the live
// patches (Register.patchSelectionAttributes) write the same attributes in
// the same order the renderer bakes, so patched rows still compare equal.
//
// Fast paths, both falling back to the single innerHTML write:
// - The live container holds no keyed rows (first commit, the empty-state
//   block, or a cleared window): nothing to reuse.
// - No next key exists in the live DOM (a long scroll jump lands on a fully
//   disjoint window): morphing would just be a slower rewrite.
// Morphing only pays when windows overlap — which is every commit during
// normal scrolling, where consecutive windows share all but a few rows.
export function commitRegisterRowsHTML(
  rowsElement: HTMLElement,
  html: string
): RegisterCommitMode {
  const liveByKey = collectKeyedChildren(rowsElement);
  if (liveByKey == null || liveByKey.size === 0) {
    rowsElement.innerHTML = html;
    return 'replace';
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const nextChildren = Array.from(template.content.children);
  const nextKeys: (string | null)[] = [];
  let overlaps = false;
  for (const child of nextChildren) {
    const key = getRowKey(child);
    nextKeys.push(key);
    if (key != null && liveByKey.has(key)) {
      overlaps = true;
    }
  }
  if (!overlaps) {
    rowsElement.innerHTML = html;
    return 'replace';
  }
  // Walk next rows in order, ensuring position i holds the right element:
  // reuse the live element when its key matches with identical bytes (moving
  // it into position if the order shifted), otherwise insert the freshly
  // parsed one. Live elements that were not reused drift toward the tail as
  // insertions push them back, so one trailing removal pass drops every
  // evicted or superseded row.
  for (const [index, nextChild] of nextChildren.entries()) {
    const key = nextKeys[index];
    const existing = key != null ? liveByKey.get(key) : undefined;
    const node =
      existing != null && isRowUnchanged(existing, nextChild)
        ? existing
        : nextChild;
    const current = rowsElement.children[index] ?? null;
    if (current !== node) {
      rowsElement.insertBefore(node, current);
    }
  }
  while (rowsElement.children.length > nextChildren.length) {
    rowsElement.children[nextChildren.length]?.remove();
  }
  return 'morph';
}

// Live children keyed by row identity, or null when any child lacks a key
// (foreign content like the empty-state block — bail to the rewrite path
// rather than guess).
function collectKeyedChildren(
  rowsElement: HTMLElement
): Map<string, Element> | null {
  const byKey = new Map<string, Element>();
  for (const child of rowsElement.children) {
    const key = getRowKey(child);
    if (key == null) {
      return null;
    }
    byKey.set(key, child);
  }
  return byKey;
}

function getRowKey(element: Element): string | null {
  const rowIndex = element.getAttribute('data-row-index');
  if (rowIndex != null) {
    return `r:${rowIndex}`;
  }
  const groupKey = element.getAttribute('data-group-key');
  if (groupKey != null) {
    return `g:${groupKey}`;
  }
  return null;
}

// Byte-equality with the two post-commit-patched attributes masked out (see
// the module comment). The clone is taken only when one of them is present —
// at most two rows per window (one focused, one hovered) — so the common row
// compares with zero allocation beyond the serialized strings.
function isRowUnchanged(live: Element, next: Element): boolean {
  if (
    !live.hasAttribute('data-focused') &&
    !live.hasAttribute('data-hovered')
  ) {
    return live.outerHTML === next.outerHTML;
  }
  const clone = live.cloneNode(true) as Element;
  clone.removeAttribute('data-focused');
  clone.removeAttribute('data-hovered');
  return clone.outerHTML === next.outerHTML;
}
