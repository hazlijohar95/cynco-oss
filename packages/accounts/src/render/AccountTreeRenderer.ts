// Pure HTML string builders for account tree rows. No DOM APIs anywhere:
// the same functions drive the client window commits (innerHTML), the SSR
// preload path, and deterministic string-projection tests.

import type {
  AccountDecorationTone,
  AccountIconResolver,
  AccountRowDecorationsRenderer,
  AccountTreeRowData,
  RowRange,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { ACCOUNT_ICON_PATHS } from './accountIcons';

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
  /**
   * Path of the row currently in an inline rename session. That row renders
   * a text input (seeded with `renameDraft`) in place of its label, so the
   * editor survives window rewrites: the controller owns the session state
   * and the renderer reproduces the input wherever the row materializes.
   */
  renamingPath?: string | null;
  /** Current rename draft, baked into the input's value attribute. */
  renameDraft?: string;
  /**
   * True when the view has a context-menu composition configured: rows gain
   * `aria-haspopup="menu"` so assistive tech announces the affordance.
   */
  contextMenu?: boolean;
  /**
   * True when `contextMenu.rowButton` is enabled: rows render a trailing
   * "Row actions" button (revealed on hover/focus-within via CSS) that opens
   * the menu with the button's rect as the anchor.
   */
  contextMenuRowButton?: boolean;
  /**
   * Icon resolver (the `icons.resolver` option). Called once per rendered
   * row per window commit while building row HTML — the hot path — so it
   * must be cheap and pure. Omitted → rows render no icon markup at all.
   */
  iconResolver?: AccountIconResolver;
  /**
   * Host decoration renderer (the `renderDecorations` option). Same hot-path
   * contract as `iconResolver`. Omitted → rows render no decoration lane.
   */
  renderDecorations?: AccountRowDecorationsRenderer;
}

// Chevron drawn with an inline SVG path in currentColor; collapsed groups
// rotate it via CSS ([data-expanded='false']), so expansion toggles never
// swap markup.
const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none">' +
  '<path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"></path></svg>';

// Horizontal ellipsis for the row-actions button, drawn in currentColor so
// the button inherits the row's foreground chain like the chevron does.
const ELLIPSIS_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
  '<circle cx="3.5" cy="8" r="1.25"></circle>' +
  '<circle cx="8" cy="8" r="1.25"></circle>' +
  '<circle cx="12.5" cy="8" r="1.25"></circle></svg>';

/**
 * One tree row. Structure:
 * indent guides | chevron | icon | name | status dot + count | decorations |
 * balance.
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
  if (row.loadPlaceholder != null) {
    return renderChildLoadPlaceholderHTML(row, index);
  }
  let html = `<div${rowAttributesHTML(row, index, options)}>`;
  html += renderIndentGuidesHTML(row.depth);
  html +=
    row.kind === 'group'
      ? `<span data-chevron aria-hidden="true">${CHEVRON_SVG}</span>`
      : '<span data-chevron data-chevron-leaf aria-hidden="true"></span>';
  // The icon renders before the rename branch so the renaming row keeps it —
  // the account's identity does not vanish while its name is being edited.
  html += renderIconHTML(row, options);
  if (options.renamingPath != null && options.renamingPath === row.path) {
    // Inline rename: the input replaces the label AND the trailing cells so
    // the editor gets the row's full width. Status/balance return with the
    // next render after the session ends.
    html += renderRenameInputHTML(row, options);
  } else {
    html += renderRowLabelHTML(row);
    html += renderStatusHTML(row);
    html += renderDecorationsHTML(row, options);
    html += renderBalanceHTML(row, options);
    if (options.contextMenuRowButton === true) {
      html += renderRowActionButtonHTML();
    }
  }
  html += '</div>';
  return html;
}

/**
 * Synthetic child-load placeholder row (the loading dots / error+Retry row
 * under an expanded pending group). NOT a treeitem: it names no account, so
 * it carries no role/aria-level/posinset and is never selectable, draggable,
 * or a drop target. `data-row-index` is still present so the row occupies
 * its projection slot consistently with the window math.
 *
 * - Loading: purely visual (three CSS-animated dots honoring
 *   prefers-reduced-motion), `aria-hidden` — assistive tech hears the state
 *   from the GROUP row's `aria-busy="true"` instead, and no child rows exist
 *   yet so there are no aria-setsize semantics to fake.
 * - Error: visible to AT. The Retry button is a real, labelled `<button>`
 *   with `tabindex="0"` — the deliberate exception to the roving-tabindex
 *   pattern (rows and the row-actions button all use -1): the row is not a
 *   treeitem, so aria-activedescendant navigation can never reach it, and a
 *   keyboard user must still be able to Tab onto the only recovery control.
 */
function renderChildLoadPlaceholderHTML(
  row: AccountTreeRowData,
  index: number
): string {
  const placeholder = row.loadPlaceholder;
  if (placeholder == null) {
    return '';
  }
  const parentLeaf = placeholder.parentPath.split(':').at(-1) ?? '';
  let html =
    `<div data-row data-load-placeholder="${placeholder.state}"` +
    ` data-row-index="${index}" data-depth="${row.depth}"` +
    (placeholder.state === 'loading' ? ' aria-hidden="true"' : '') +
    '>';
  html += renderIndentGuidesHTML(row.depth);
  html += '<span data-chevron data-chevron-leaf aria-hidden="true"></span>';
  if (placeholder.state === 'loading') {
    html +=
      '<span data-load-dots aria-hidden="true">' +
      '<span></span><span></span><span></span></span>';
  } else {
    const message =
      placeholder.error != null && placeholder.error !== ''
        ? `Couldn’t load accounts: ${escapeHtml(placeholder.error)}`
        : 'Couldn’t load accounts';
    html += `<span data-load-error-message>${message}</span>`;
    html +=
      '<button data-load-retry type="button" tabindex="0"' +
      ` data-load-parent="${escapeHtml(placeholder.parentPath)}"` +
      ` aria-label="Retry loading ${escapeHtml(parentLeaf)}">Retry</button>`;
  }
  html += '</div>';
  return html;
}

// Trailing per-row "…" button opening the context menu (Pierre's row menu
// button lane adapted to string rendering). A real, labelled control — like
// the rename input, it lives inside the treeitem without breaking its
// semantics — but tabindex -1 so the roving tabindex stays on rows; keyboard
// users open the menu via Shift+F10 / the ContextMenu key instead. CSS keeps
// it invisible until row hover / focus-within.
function renderRowActionButtonHTML(): string {
  return (
    '<button data-row-action type="button" tabindex="-1"' +
    ' aria-label="Row actions" aria-haspopup="menu">' +
    `${ELLIPSIS_SVG}</button>`
  );
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
  // data-path (never present on flow rows, which identify by index) lets
  // the sticky-stack click forwarder resolve the real ancestor row even
  // after scrolling has shifted every visible index.
  let html =
    '<div data-row data-sticky-row="true" aria-hidden="true"' +
    ` data-path="${escapeHtml(row.path)}"` +
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
  html += renderIconHTML(row, options);
  html += renderRowLabelHTML(row);
  html += renderStatusHTML(row);
  html += renderDecorationsHTML(row, options);
  html += renderBalanceHTML(row, options);
  html += '</div>';
  return html;
}

// Row label: a plain leaf name, or — for flattened single-child group
// chains — the chain's segments joined with punctuation-colored `:`
// separators (`Income : Sales`), matching the trees.software flattened-label
// presentation with our path separator.
function renderRowLabelHTML(row: AccountTreeRowData): string {
  const { flattenedNames } = row;
  if (flattenedNames == null || flattenedNames.length < 2) {
    return `<span data-name>${escapeHtml(row.name)}</span>`;
  }
  let html = '<span data-name data-flattened="true">';
  for (let index = 0; index < flattenedNames.length; index += 1) {
    if (index > 0) {
      html += '<span data-name-separator aria-hidden="true">:</span>';
    }
    html += `<span data-name-segment>${escapeHtml(flattenedNames[index])}</span>`;
  }
  html += '</span>';
  return html;
}

// Inline rename editor (Pierre's RenameInput adapted to string rendering):
// inset background, hairline border, focus ring via CSS. The draft value is
// baked into the value attribute so a re-rendered row reproduces the
// in-progress text; the view re-focuses it after window rewrites.
function renderRenameInputHTML(
  row: AccountTreeRowData,
  options: AccountTreeRenderOptions
): string {
  const draft = options.renameDraft ?? row.name;
  return (
    '<input data-rename-input type="text" spellcheck="false"' +
    ` aria-label="Rename ${escapeHtml(row.name)}"` +
    ` value="${escapeHtml(draft)}">`
  );
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
  if (options.contextMenu === true) {
    // Announce the menu affordance on every row (right-click / Shift+F10 /
    // ContextMenu key all target the row), not just the optional button.
    attributes += ' aria-haspopup="menu"';
  }
  if (row.kind === 'group') {
    attributes += ` data-expanded="${row.expanded}" aria-expanded="${row.expanded}"`;
    // A group with a child fetch in flight announces busy; the loading
    // placeholder row itself is aria-hidden (see the placeholder renderer).
    if (row.childLoadState === 'loading') {
      attributes += ' aria-busy="true"';
    }
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
  if (row.flattenedNames != null) {
    attributes += ' data-flattened-row="true"';
  }
  // Rows are HTML5 drag sources (re-parenting); group rows double as drop
  // targets, validated in the view's dragover handler.
  attributes += ' draggable="true"';
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

/**
 * Account icon between the chevron and the name. The resolver runs HERE —
 * once per rendered row per window commit, never per attribute patch — so
 * icon changes flow through normal window commits and resolvers must be
 * cheap and pure. Returning null renders nothing (identical markup to a
 * tree without the option). SECURITY: the returned name is validated
 * against the closed built-in record before anything interpolates; only
 * our own path data ever enters the SVG (see accountIcons.ts).
 */
function renderIconHTML(
  row: AccountTreeRowData,
  options: AccountTreeRenderOptions
): string {
  const resolver = options.iconResolver;
  if (resolver == null) {
    return '';
  }
  const name = resolver({
    path: row.path,
    name: row.name,
    isGroup: row.kind === 'group',
    depth: row.depth,
  });
  // The `in` check is the runtime half of the closed-union XSS boundary:
  // untyped JS hosts can return arbitrary strings, which must resolve to
  // "no icon", never to interpolated markup.
  if (name == null || !(name in ACCOUNT_ICON_PATHS)) {
    return '';
  }
  // Decorative: the name text already identifies the row to AT. Sized via
  // --accounts-icon-size (density-scaled) in the stylesheet.
  return (
    `<span data-icon data-icon-name="${escapeHtml(name)}" aria-hidden="true">` +
    '<svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd">' +
    `<path d="${ACCOUNT_ICON_PATHS[name]}"></path></svg></span>`
  );
}

// Valid decoration tones, for runtime validation before interpolation
// (mirrors the AccountDecorationTone union for untyped JS hosts).
const DECORATION_TONES: ReadonlySet<AccountDecorationTone> = new Set([
  'neutral',
  'info',
  'success',
  'warn',
  'danger',
]);

/**
 * Cap on rendered decorations per row. Rows are FIXED HEIGHT — the whole
 * virtualization contract is `index * rowHeight` arithmetic — so an
 * unbounded lane would either overflow horizontally into the balance column
 * or pressure rows to wrap/grow, both of which break the row contract.
 * Three small badges is the most a 30px row wears comfortably.
 */
const MAX_ROW_DECORATIONS = 3;

/**
 * Host-driven decoration lane, rendered AFTER the controller-driven status
 * dot and before the balance. The two lanes are deliberately distinct:
 * status dots come from `setAccountStatus` (controller state, rolled up
 * onto collapsed ancestors); decorations come from the host's
 * `renderDecorations` callback per commit and roll up nothing.
 *
 * Accessibility: the treeitem has no aria-label, so its accessible name is
 * computed from its text content (name, status count, balance...). Text
 * decorations deliberately stay visible to AT and join that name naturally;
 * dots are purely decorative and carry aria-hidden — a bare colored circle
 * has no announceable meaning.
 */
function renderDecorationsHTML(
  row: AccountTreeRowData,
  options: AccountTreeRenderOptions
): string {
  const render = options.renderDecorations;
  if (render == null) {
    return '';
  }
  const decorations = render({
    path: row.path,
    name: row.name,
    isGroup: row.kind === 'group',
    depth: row.depth,
    visibleChildCount: row.visibleChildCount,
  });
  if (decorations == null || decorations.length === 0) {
    return '';
  }
  const count = Math.min(decorations.length, MAX_ROW_DECORATIONS);
  let html = '<span data-decorations>';
  for (let index = 0; index < count; index += 1) {
    const decoration = decorations[index];
    const tone: AccountDecorationTone = DECORATION_TONES.has(
      decoration.tone ?? 'neutral'
    )
      ? (decoration.tone ?? 'neutral')
      : 'neutral';
    if (decoration.kind === 'dot') {
      html += `<span data-decoration-dot data-tone="${tone}" aria-hidden="true"></span>`;
    } else {
      // Host text is untrusted: escaped like every other interpolation.
      html += `<span data-decoration-text data-tone="${tone}">${escapeHtml(
        decoration.text
      )}</span>`;
    }
  }
  html += '</span>';
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
