// Pure HTML string builders for account tree rows. No DOM APIs anywhere:
// the same functions drive the client window commits (innerHTML), the SSR
// preload path, and deterministic string-projection tests.

import type { AccountTreeRowData, RowRange } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';

export interface AccountTreeRenderOptions {
  /**
   * Primary display currency for the balance column. Only used for decimal
   * placement — the controller already extracted the amount for this
   * currency into each row's `balance`.
   */
  currency: string;
  /** Whether rows render the right-aligned balance column. Default true. */
  showBalances?: boolean;
  /**
   * Stable id prefix baked into row `id` attributes so the view can point
   * `aria-activedescendant` at the focused row. Omitted → rows carry no id.
   */
  idPrefix?: string;
}

// Chevron drawn with an inline SVG path in currentColor; collapsed groups
// rotate it via CSS ([data-expanded='false']), so expansion toggles never
// swap markup.
const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none">' +
  '<path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"></path></svg>';

/**
 * One tree row. Structure:
 * indent guides | chevron | name | status dot + count | balance.
 * State is carried exclusively by data attributes ([data-kind],
 * [data-expanded], [data-selected], ...) plus the WAI-ARIA treeitem
 * contract; the store supplies aria-posinset/aria-setsize so the values stay
 * correct under virtualization where siblings are not all in the DOM.
 */
export function renderAccountRowHTML(
  row: AccountTreeRowData,
  index: number,
  options: AccountTreeRenderOptions
): string {
  let html = `<div${rowAttributesHTML(row, index, options)}>`;
  html += renderIndentGuidesHTML(row.depth);
  html +=
    row.kind === 'group'
      ? `<span data-chevron aria-hidden="true">${CHEVRON_SVG}</span>`
      : '<span data-chevron data-chevron-leaf aria-hidden="true"></span>';
  html += `<span data-name>${escapeHtml(row.name)}</span>`;
  html += renderStatusHTML(row);
  html += renderBalanceHTML(row, options);
  html += '</div>';
  return html;
}

/**
 * Renders the `[start, end)` slice of rows in one string so the view can
 * commit a whole window with a single innerHTML write. `rows` must already
 * be the slice for that range (rows[0] renders at index range.start).
 */
export function renderAccountRowsHTML(
  rows: readonly AccountTreeRowData[],
  range: RowRange,
  options: AccountTreeRenderOptions
): string {
  let html = '';
  for (let offset = 0; offset < rows.length; offset += 1) {
    html += renderAccountRowHTML(rows[offset], range.start + offset, options);
  }
  return html;
}

/**
 * Sticky mirror row: identical visual content to a flow row but no treeitem
 * semantics (no role/aria/tabindex/id) and aria-hidden on the wrapper, so
 * assistive tech never sees the account twice — the same split Pierre's
 * sticky overlay rows use.
 */
export function renderStickyRowHTML(
  row: AccountTreeRowData,
  options: AccountTreeRenderOptions
): string {
  let html =
    '<div data-row data-sticky-row="true" aria-hidden="true"' +
    ` data-depth="${row.depth}" data-kind="${row.kind}"` +
    ` data-expanded="${row.expanded}"` +
    (row.selected ? ' data-selected="true"' : '') +
    (row.status != null ? ` data-status="${row.status}"` : '') +
    '>';
  html += renderIndentGuidesHTML(row.depth);
  html +=
    row.kind === 'group'
      ? `<span data-chevron aria-hidden="true">${CHEVRON_SVG}</span>`
      : '<span data-chevron data-chevron-leaf aria-hidden="true"></span>';
  html += `<span data-name>${escapeHtml(row.name)}</span>`;
  html += renderStatusHTML(row);
  html += renderBalanceHTML(row, options);
  html += '</div>';
  return html;
}

/**
 * Full tree shell for SSR and for the client's first mount: scroller,
 * sticky-header slot, spacers, and the given pre-rendered row window. The
 * after-spacer carries the pixel height of every unrendered row so scrollbar
 * geometry is correct before the client re-windows.
 */
export function renderAccountTreeShellHTML({
  rowsHTML,
  range,
  totalCount,
  rowHeight,
  density,
  ariaLabel,
}: {
  rowsHTML: string;
  range: RowRange;
  totalCount: number;
  rowHeight: number;
  density: string;
  ariaLabel: string;
}): string {
  const beforeHeight = range.start * rowHeight;
  const afterHeight = Math.max(0, totalCount - range.end) * rowHeight;
  return (
    `<div data-scroller data-density="${escapeHtml(density)}" tabindex="0"` +
    ` role="tree" aria-label="${escapeHtml(ariaLabel)}">` +
    '<div data-accounts-content>' +
    '<div data-sticky-header aria-hidden="true" hidden></div>' +
    `<div data-spacer="before" style="height: ${beforeHeight}px"></div>` +
    `<div data-rows>${rowsHTML}</div>` +
    `<div data-spacer="after" style="height: ${afterHeight}px"></div>` +
    '</div></div>'
  );
}

// Attribute bag for a flow row. aria-expanded only exists on groups (leaves
// must not announce as expandable) and aria-level is 1-based per WAI-ARIA.
function rowAttributesHTML(
  row: AccountTreeRowData,
  index: number,
  options: AccountTreeRenderOptions
): string {
  let attributes =
    ' data-row role="treeitem"' +
    ` data-row-index="${index}"` +
    ` data-depth="${row.depth}"` +
    ` data-kind="${row.kind}"` +
    ` aria-level="${row.depth + 1}"` +
    ` aria-posinset="${row.posInSet}"` +
    ` aria-setsize="${row.setSize}"` +
    ` aria-selected="${row.selected}"`;
  if (options.idPrefix != null && options.idPrefix !== '') {
    attributes += ` id="${escapeHtml(options.idPrefix)}-row-${index}"`;
  }
  if (row.kind === 'group') {
    attributes += ` data-expanded="${row.expanded}" aria-expanded="${row.expanded}"`;
  }
  if (row.selected) {
    attributes += ' data-selected="true"';
  }
  if (row.focused) {
    attributes += ' data-focused="true"';
  }
  if (row.searchMatch) {
    attributes += ' data-search-match="true"';
  }
  if (row.status != null) {
    attributes += ` data-status="${row.status}"`;
  }
  attributes += ` tabindex="${row.focused ? 0 : -1}"`;
  return attributes;
}

// One 1px guide line per ancestor level, absolutely positioned by CSS inside
// the relatively positioned spacing container. The container width also
// provides the row's indentation, so guides and indent can never disagree.
function renderIndentGuidesHTML(depth: number): string {
  if (depth <= 0) {
    return '';
  }
  let html = '<span data-row-spacing aria-hidden="true">';
  for (let level = 0; level < depth; level += 1) {
    html += '<span data-indent-guide></span>';
  }
  html += '</span>';
  return html;
}

// Status dot plus optional count. The dot is a pure CSS circle colored by
// [data-status]; the count stays quiet next to it.
function renderStatusHTML(row: AccountTreeRowData): string {
  if (row.status == null) {
    return '';
  }
  let html = `<span data-status-dot data-status="${row.status}" aria-hidden="true"></span>`;
  if (row.statusCount > 0) {
    html += `<span data-status-count data-status="${row.status}">${row.statusCount}</span>`;
  }
  return html;
}

// Right-aligned rolled balance in the primary display currency. Accounts
// with no balance in that currency (absence means zero) render no balance
// span at all, keeping zero-activity charts visually quiet.
function renderBalanceHTML(
  row: AccountTreeRowData,
  options: AccountTreeRenderOptions
): string {
  if (options.showBalances === false || row.balance == null) {
    return '';
  }
  const negative = row.balance < 0 ? ' data-negative="true"' : '';
  return (
    `<span data-balance${negative}>` +
    `${formatMinorUnits(row.balance, options.currency)}</span>`
  );
}
