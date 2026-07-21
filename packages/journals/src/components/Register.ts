import {
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_OVERSCAN_ROWS,
  DEFAULT_VIEWPORT_HEIGHT,
  GROUP_HEADER_EXTRA_HEIGHT,
  JOURNALS_TAG_NAME,
  REGISTER_EMPTY_EXTRA_HEIGHT,
} from '../constants';
import {
  InteractionManager,
  type RowSelectModifiers,
} from '../managers/InteractionManager';
import { queueRender } from '../managers/UniversalRenderingManager';
import {
  finalRegisterBalances,
  type RegisterRenderOptions,
  renderRegisterEmptyStateHTML,
  renderRegisterHeaderHTML,
  renderRegisterRowsHTML,
  renderRegisterVirtualRowsHTML,
  renderStickyGroupContainerHTML,
  renderStickyGroupLabelHTML,
} from '../renderers/RegisterRenderer';
import type {
  ColorScheme,
  RegisterFilter,
  RegisterFilterResult,
  RegisterRowData,
  RegisterSelection,
  RegisterSelectionChange,
  RegisterSelectionMode,
  RegisterVirtualRow,
  RowRange,
  ScrollToRowOptions,
  SmoothScrollSettings,
  VirtualWindowSpecs,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { buildFilteredRegisterRowModel } from '../utils/buildFilteredRegisterRowModel';
import {
  buildRegisterFilterCorpus,
  type RegisterFilterCorpus,
} from '../utils/buildRegisterFilterCorpus';
import { buildRegisterRowModel } from '../utils/buildRegisterRowModel';
import { computeGroupedRowWindow } from '../utils/computeGroupedRowWindow';
import { computeRegisterFilterMatches } from '../utils/computeRegisterFilterMatches';
import { computeRowModelOffsets } from '../utils/computeRowModelOffsets';
import { computeRowWindow } from '../utils/computeRowWindow';
import { findFirstRowOnOrAfterDate } from '../utils/findFirstRowOnOrAfterDate';
import { findRowIndexAtOffset } from '../utils/findRowIndexAtOffset';
import { isComposingEvent } from '../utils/isComposingEvent';
import { SmoothScroller } from '../utils/SmoothScroller';
import type { WorkerPoolManager } from '../worker/WorkerPoolManager';
import { type VirtualizedInstance, Virtualizer } from './Virtualizer';
import { JournalsContainerLoaded } from './web-components';

export interface RegisterOptions extends RegisterRenderOptions {
  /**
   * Pins how `light-dark()` colors resolve. The stylesheet declares
   * `:host { color-scheme: light dark }`, which resolves from the USER's OS
   * preference — not the page's chosen theme — so sites with their own
   * light/dark toggle render the wrong mode unless they pin this. `light` /
   * `dark` apply an inline `color-scheme` on the host element (outer tree,
   * so it wins over `:host`); `system` (default) removes the pin and defers
   * to page CSS (e.g. `.dark journals-container { color-scheme: dark }`) or
   * the OS preference.
   */
  colorScheme?: ColorScheme;
  /**
   * Pixel height of one text line. Must match the effective
   * `--journals-line-height` custom property (default 20px) or virtualized
   * spacer heights will drift from real layout.
   */
  lineHeight?: number;
  /**
   * Sticky header height in px. Must match the `min-height` on
   * `[data-register-header]` (default 44px = 1lh + 24px padding).
   */
  headerHeight?: number;
  /** Extra rows rendered above and below the pixel window. Default 10. */
  overscanRows?: number;
  /**
   * Shared Virtualizer (LedgerView passes one per scroll container). When
   * omitted the register creates and owns its own, using its scroller as the
   * virtualization root.
   */
  virtualizer?: Virtualizer;
  /**
   * Top offset of this section within the scroll content, in px. Standalone
   * registers sit at the content top (0); LedgerView supplies estimated
   * offsets computed from preceding section heights, avoiding layout reads.
   */
  getOffsetTop?(): number;
  /**
   * Shared SmoothScroller (LedgerView passes one per scroll container, like
   * `virtualizer`) so every section's scroll-to retargets the SAME spring
   * instead of two animators fighting over one scrollTop. When omitted the
   * register lazily creates and owns one bound to its own scroller.
   */
  smoothScroller?: SmoothScroller;
  /** Spring tuning for the owned SmoothScroller; ignored when a shared one
   * is supplied (its creator tuned it). */
  smoothScrollSettings?: SmoothScrollSettings;
  /**
   * Selection behavior. `single` (default) preserves the original one-row
   * behavior exactly. `range` is contiguous line selection: click selects
   * one row and sets the anchor, shift-click extends anchor→target
   * contiguously (in entry-index space, so group header rows are skipped
   * naturally), meta/ctrl-click toggles a row in or out. Keyboard mirrors
   * pointer exactly: Enter/Space act like a plain click, Shift+Arrow like a
   * shift-click, Meta/Ctrl+A selects all (range mode), Escape clears.
   */
  selectionMode?: RegisterSelectionMode;
  /**
   * Opts out of keyboard navigation entirely: no keydown listener and no
   * `tabindex="0"` on the grid. Default false — keyboard navigation ships
   * ON, which is the breaking-ish part of this feature: the register
   * becomes a tab stop on every page that embeds it. That is the right
   * default (a pointer-only data grid is inaccessible), but hosts composing
   * their own focus management can flip this switch.
   */
  disableKeyboardNavigation?: boolean;
  /** Fired when a row is clicked, after the selection attribute is applied. */
  onRowSelect?(row: RegisterRowData, index: number): void;
  /**
   * Fired whenever the keyboard-focused row changes (arrow keys, pointer
   * clicks, and programmatic `focusRow` calls all route through it); `null`
   * when focus leaves the register's rows (e.g. a LedgerView handoff to a
   * sibling section).
   */
  onFocusChange?(entryIndex: number | null, row: RegisterRowData | null): void;
  /**
   * Cross-section focus handoff hook (LedgerView). Called when ArrowDown on
   * the last entry row (direction 1) or ArrowUp on the first (direction -1)
   * has nowhere to go inside this register. Return true when the host moved
   * focus elsewhere; this register then clears its own focused row. Hosts
   * without sections simply omit it and arrows clamp at the edges.
   */
  onFocusBoundary?(direction: 1 | -1): boolean;
  /**
   * Fired on every user-driven selection change (pointer AND keyboard:
   * Enter/Space, Shift+Arrow, Meta/Ctrl+A, Escape) with the sorted entry
   * indexes and their rows. Fires in both selection modes (single mode
   * reports a 0/1-length selection); `onRowSelect` keeps firing for the
   * primary (last-clicked) row for back-compat. Programmatic
   * `setSelectedRow` calls do not fire callbacks, mirroring the original
   * behavior.
   */
  onSelectionChange?(selection: RegisterSelectionChange): void;
  /**
   * Fired after each application of an ACTIVE filter — `setFilter` with a
   * non-empty query, a filter change through `setOptions`, and `setRows`
   * while a filter is active — with the matched-row count out of the total
   * (entry rows only, never group headers). Built for host "n of m"
   * readouts; clearing the filter fires nothing (hosts reset their readout
   * when they clear).
   */
  onFilterResult?(result: RegisterFilterResult): void;
  /**
   * Optional worker pool: when present (and healthy), window HTML is
   * produced off the main thread and committed on the next animation frame.
   * Spacer heights still update synchronously, so scroll geometry (and the
   * scroll position) never jumps while a window is in flight. Without a
   * pool — or once it reports failure — the synchronous path is used
   * unchanged.
   */
  workerPool?: WorkerPoolManager;
}

export interface RegisterRenderProps {
  rows: readonly RegisterRowData[];
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

export interface RegisterHydrateProps {
  rows: readonly RegisterRowData[];
  /** Container whose (declarative) shadow root already holds SSR output. */
  container: HTMLElement;
}

export interface RegisterHydrateSectionProps {
  rows: readonly RegisterRowData[];
  /** SSR-populated `<section data-register>` inside a SHARED scroller. */
  section: HTMLElement;
  /** The shared Virtualizer driving that scroller (LedgerView's). */
  virtualizer: Virtualizer;
}

// Virtualized single-account register (bank-statement style). Fixed row
// heights make the window math pure arithmetic: rendered range and spacer
// heights derive from the Virtualizer's pixel window with no per-row
// measurement, so 100k-row registers render the same handful of nodes as
// 100-row ones. With groupBy active the row space gains a second fixed
// height (group headers), so windowing switches to prefix sums + binary
// search — still O(log n) per scroll frame, built O(n) once per data update.
let registerInstanceCount = -1;

export class Register implements VirtualizedInstance {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private scroller: HTMLElement | undefined;
  private section: HTMLElement | undefined;
  private headerElement: HTMLElement | undefined;
  private spacerBefore: HTMLElement | undefined;
  private rowsElement: HTMLElement | undefined;
  private spacerAfter: HTMLElement | undefined;

  private rows: readonly RegisterRowData[] = [];
  /**
   * Grouped and/or FILTERED row model + cumulative pixel offsets, both null
   * on the groupBy:'none', no-filter fast path so plain flat registers
   * never pay for the offsets array. Rebuilt once per data/projection
   * update (O(n)), consumed by O(log n) windowing. An active filter forces
   * the model path even when ungrouped — the visible row space is then the
   * matched rows, not the raw array.
   */
  private rowModel: RegisterVirtualRow[] | null = null;
  private rowOffsets: Float64Array | null = null;

  /**
   * Active projection filter, normalized: null whenever the query is empty
   * so every consumer can gate on one nullable field. Seeded from
   * `options.filter`, replaced by `setFilter` / `setOptions`. The filter is
   * a projection-level OVERLAY (the accounts tree's hide-non-matches
   * philosophy): canonical rows, selection, and every public entry index
   * stay in FULL-data space — only visibility changes.
   */
  private activeFilter: RegisterFilter | null = null;
  /**
   * Lazy lowercase corpus for filter matching (the EntryStore idiom): built
   * on the first filter application, reused across query changes, dropped
   * on setRows (it is positional over the rows array). Null until needed so
   * unfiltered registers never pay the lowercase pass.
   */
  private filterCorpus: RegisterFilterCorpus | null = null;
  /**
   * Matched entry indexes (ascending) while a filter is active, plus the
   * inverse map entryIndex → visible position (-1 = filtered out). Keyboard
   * navigation walks these; both null without a filter, where visible
   * position === entry index.
   */
  private filteredEntryIndexes: number[] | null = null;
  private entryToFilteredPosition: Int32Array | null = null;

  /** Selected entry indexes (entry-index space, never group rows). */
  private selectedIndexes = new Set<number>();
  /** Row shift-ranges extend from. */
  private selectionAnchor: number | null = null;
  /** Last-clicked row, reported by getSelectedRow for back-compat. */
  private selectionPrimary: number | null = null;
  /** Keyboard-focused entry row (aria-activedescendant target), or null. */
  private focusedIndex: number | null = null;
  /**
   * entryIndex → model index for the grouped path, built alongside the row
   * model (O(n) once per data update) so focus reveal can look up a row's
   * pixel offset without scanning the model per keystroke. Null on the flat
   * path where model index === entry index.
   */
  private entryToModelIndex: Int32Array | null = null;

  private renderedRange: RowRange | undefined;
  private visible = false;

  /** Unique per instance, prefixes worker cache keys so instances never collide. */
  private readonly workerInstanceId: string = `register-${++registerInstanceCount}`;
  /**
   * Stable prefix for row `id` attributes (aria-activedescendant targets):
   * the caller-supplied `options.id` (required for SSR/client agreement — a
   * hydrated register must reproduce the ids the preload emitted) or the
   * auto-generated per-instance id. Fixed at construction like AccountTree.
   */
  private readonly instanceId: string;
  /** Bumped per setRows so stale row data can never satisfy a cache key. */
  private rowsVersion = 0;
  /** Stamp for in-flight worker windows; only the latest response applies. */
  private windowRenderVersion = 0;

  private virtualizer: Virtualizer | undefined;
  private ownsVirtualizer = false;
  private disconnectVirtualizer: (() => void) | undefined;
  private interactionManager: InteractionManager;

  private smoothScroller: SmoothScroller | undefined;
  private ownsSmoothScroller = false;

  /** Sticky current-period mirror container (grouped registers only). */
  private stickyGroupElement: HTMLElement | undefined;
  /**
   * Model index of the group the mirror currently shows, or null while
   * hidden. The per-frame lookup is O(log n) (binary search over the prefix
   * sums) but the DOM write happens only when this index changes.
   */
  private stickyGroupIndex: number | null = null;
  /**
   * modelIndex → model index of the group header governing that row, built
   * with the row model (O(n) once per data update) so the sticky label
   * resolves "which period owns the top visible row" in O(1) after the
   * binary search. Null on the flat path.
   */
  private modelToGroupIndex: Int32Array | null = null;

  constructor(
    public options: RegisterOptions,
    private isContainerManaged = false
  ) {
    this.instanceId = options.id ?? this.workerInstanceId;
    this.activeFilter = normalizeRegisterFilter(options.filter ?? null);
    this.interactionManager = new InteractionManager({
      onRowSelect: this.handleRowSelect,
    });
  }

  setOptions(options: RegisterOptions | undefined): void {
    if (options == null) return;
    // Reference bail-out (the setRows idiom): a same-reference options
    // object cannot carry changes — callers passing fresh objects (even
    // with stable nested data) still take the full path, so this only
    // skips the per-render no-op work the React adapter would otherwise
    // trigger. Deliberately NOT a deep/shallow compare.
    if (options === this.options) {
      return;
    }
    const previousGroupBy = this.options.groupBy ?? 'none';
    const previousFilter = this.options.filter ?? null;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
    // groupBy / filter changes reshape the virtual row space, so rebuild
    // the model and re-window in place (filters compare by reference, the
    // Reconciliation data-change idiom). Density/lineHeight changes still
    // require a full re-render (documented on RegisterRenderOptions.density).
    const groupByChanged = (options.groupBy ?? 'none') !== previousGroupBy;
    const filterChanged = (options.filter ?? null) !== previousFilter;
    if (filterChanged) {
      this.activeFilter = normalizeRegisterFilter(options.filter ?? null);
    }
    if ((groupByChanged && this.rows.length > 0) || filterChanged) {
      this.reprojectRows();
    }
    // groupBy / stickyGroupLabels feed the sticky period mirror.
    this.ensureStickyGroupElement();
    this.updateStickyGroupLabel();
    // label / selectionMode / groupBy all feed grid-level ARIA state.
    this.updateGridAttributes();
  }

  /**
   * Applies (or clears, with null / an empty query) the projection-level
   * row filter in place: the visible row model reshapes to matched rows,
   * while canonical data, selection, and every public entry index stay in
   * FULL-data space. Selection is never mutated — filtered-out selected
   * rows simply are not rendered, and reappear (still selected) once the
   * filter releases them. Fires `onFilterResult` when the filter is active.
   */
  setFilter(filter: RegisterFilter | null): void {
    this.activeFilter = normalizeRegisterFilter(filter);
    this.reprojectRows();
  }

  // Standalone entry point: builds scroller + section inside the container's
  // shadow root and drives it with an owned Virtualizer.
  render({ rows, container, parentNode }: RegisterRenderProps): void {
    container =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (parentNode != null && container.parentNode !== parentNode) {
      parentNode.appendChild(container);
    }
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    if (this.scroller == null || this.scroller.parentNode !== shadowRoot) {
      const scroller = document.createElement('div');
      scroller.setAttribute('data-scroller', '');
      const content = document.createElement('div');
      content.setAttribute('data-journals-content', '');
      scroller.appendChild(content);
      shadowRoot.appendChild(scroller);
      this.scroller = scroller;
      const section = this.createSectionElement();
      content.appendChild(section);
      this.adoptSection(section);
    }
    this.setupOwnedVirtualizer();
    this.setRows(rows);
  }

  // Adopts SSR output (scroller/section already inside the shadow root) and
  // starts virtualization. The pre-rendered rows stay untouched until the
  // first virtualized pass windows them.
  hydrate({ rows, container }: RegisterHydrateProps): void {
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const scroller = shadowRoot.querySelector('[data-scroller]');
    const section = shadowRoot.querySelector('[data-register]');
    if (
      !(scroller instanceof HTMLElement) ||
      !(section instanceof HTMLElement)
    ) {
      this.render({ rows, container });
      return;
    }
    this.scroller = scroller;
    this.adoptSection(section);
    this.rows = rows;
    this.rebuildRowModel();
    // adoptSection ran before rows existed; refresh aria-rowcount now.
    this.updateGridAttributes();
    this.setupOwnedVirtualizer();
    this.virtualizer?.instanceChanged();
  }

  // LedgerView entry point: takes ownership of a provided <section> inside a
  // shared scroll container instead of building its own scroller.
  mountSection(section: HTMLElement, virtualizer: Virtualizer): void {
    this.populateSectionElement(section);
    this.adoptSection(section);
    this.virtualizer = virtualizer;
    this.ownsVirtualizer = false;
    this.disconnectVirtualizer = virtualizer.connect(section, this);
  }

  // LedgerView hydration entry point: adopts an SSR-populated section inside
  // a shared scroller with ZERO DOM rebuilds (the Register.hydrate idiom,
  // minus scroller ownership). Pre-rendered rows stay untouched until the
  // first virtualized pass re-windows them.
  hydrateSection({
    rows,
    section,
    virtualizer,
  }: RegisterHydrateSectionProps): void {
    this.adoptSection(section);
    this.virtualizer = virtualizer;
    this.ownsVirtualizer = false;
    this.disconnectVirtualizer = virtualizer.connect(section, this);
    this.rows = rows;
    this.rebuildRowModel();
    // adoptSection ran before rows existed; refresh aria-rowcount now.
    this.updateGridAttributes();
  }

  setRows(rows: readonly RegisterRowData[]): void {
    // Reference bail-out: the React adapter pushes props on EVERY committed
    // render, so an unchanged rows array must not bump rowsVersion (which
    // would invalidate the worker LRU cache), drop the filter corpus, or
    // rebuild the header/window. Rows are treated as immutable — in-place
    // mutation followed by a same-reference setRows is unsupported (pass a
    // fresh array to force a rebuild).
    if (rows === this.rows) {
      return;
    }
    this.rows = rows;
    this.rowsVersion += 1;
    // The lazy filter corpus is positional over the rows array, so any data
    // change invalidates it wholesale; the next match pass rebuilds it.
    this.filterCorpus = null;
    this.rebuildRowModel();
    this.renderedRange = undefined;
    // Focus must never dangle past the data: clamp silently (no callback —
    // this is a data change, not a navigation event).
    if (this.focusedIndex != null && this.focusedIndex >= rows.length) {
      this.focusedIndex = rows.length > 0 ? rows.length - 1 : null;
    }
    // Same silent rule when the new data no longer matches an active filter
    // for the focused row: focus is presentation state over the visible
    // grid, and the row is no longer visible.
    if (
      this.focusedIndex != null &&
      this.entryToFilteredPosition != null &&
      this.entryToFilteredPosition[this.focusedIndex] === -1
    ) {
      this.focusedIndex = null;
    }
    this.updateGridAttributes();
    if (this.headerElement != null && this.section != null) {
      const template = document.createElement('div');
      template.innerHTML = renderRegisterHeaderHTML(
        this.options.account,
        finalRegisterBalances(rows)
      );
      const nextHeader = template.firstElementChild;
      if (nextHeader instanceof HTMLElement) {
        this.headerElement.replaceWith(nextHeader);
        this.headerElement = nextHeader;
      }
    }
    this.applyWindow(this.getRowWindow(this.virtualizer?.getWindowSpecs()));
    // New data can move period boundaries under a stationary scroll
    // position; force a label re-derive (the cache keys on group index,
    // which may coincidentally match across datasets).
    this.stickyGroupIndex = null;
    this.updateStickyGroupLabel();
    this.virtualizer?.instanceChanged();
    // An active filter was re-applied to the new data; report fresh counts.
    this.emitFilterResult();
  }

  // Programmatic selection: replaces the whole selection with one row (or
  // clears it), patching attributes in the live DOM. Fires no callbacks —
  // callbacks are reserved for pointer-driven changes, as before.
  setSelectedRow(index: number | null): void {
    const previous = this.selectedIndexes;
    if (index == null) {
      if (previous.size === 0 && this.selectionPrimary == null) {
        return;
      }
      this.selectedIndexes = new Set();
      this.selectionAnchor = null;
      this.selectionPrimary = null;
    } else {
      if (
        previous.size === 1 &&
        previous.has(index) &&
        this.selectionPrimary === index
      ) {
        return;
      }
      this.selectedIndexes = new Set([index]);
      this.selectionAnchor = index;
      this.selectionPrimary = index;
    }
    this.patchSelectionAttributes(previous);
  }

  getSelectedRow(): number | null {
    return this.selectionPrimary;
  }

  /** Current selection state: anchor plus selected entry indexes. */
  getSelection(): RegisterSelection {
    return { anchor: this.selectionAnchor, indexes: this.selectedIndexes };
  }

  /** Keyboard-focused entry index (aria-activedescendant target), or null. */
  getFocusedRow(): number | null {
    return this.focusedIndex;
  }

  /**
   * Moves keyboard focus to an entry row (or clears it with null): reveals
   * the row, updates aria-activedescendant, and moves DOM focus onto the
   * grid so subsequent keystrokes land here. Unlike setSelectedRow this DOES
   * fire onFocusChange — LedgerView's cross-section keyboard handoff routes
   * through it, and focus observers need one consistent event stream.
   */
  focusRow(index: number | null): void {
    if (index == null) {
      this.setFocusedIndex(null);
      return;
    }
    if (this.rows[index] == null) {
      return;
    }
    // A filtered-out row cannot take visible focus (revealing it is
    // impossible while the filter hides it): graceful no-op, exactly like
    // out-of-range indexes. The index stays valid full-data space for when
    // the filter releases the row.
    if (this.getNavigablePosition(index) === -1) {
      return;
    }
    this.setFocusedIndex(index);
    this.section?.focus();
  }

  /** `[start, end)` row range currently in the DOM (exposed for tests).
   * Entry-index space when groupBy is 'none'; MODEL-index space (group
   * headers count as rows) when grouped. */
  getRenderedRange(): RowRange | undefined {
    return this.renderedRange;
  }

  /**
   * Scrolls the register so the entry row at `entryIndex` satisfies the
   * requested alignment (see {@link ScrollToRowOptions}; defaults `nearest`
   * + instant `auto`). The target position is pure data math — prefix-sum
   * offsets under grouping, arithmetic on the flat path — so no layout reads
   * happen before the scroll. Works in every mount mode: in a LedgerView
   * section the row's offset already includes the section offset within the
   * SHARED scroller (getOffsetTop), and `start` alignment lands the row just
   * below the sticky section header that overlays the viewport top.
   * Out-of-range indexes are a graceful no-op.
   */
  scrollToRow(entryIndex: number, options: ScrollToRowOptions = {}): void {
    if (this.rows[entryIndex] == null) {
      return;
    }
    // Under an active filter the entry index keeps naming the same row
    // (FULL-data space), but a filtered-out row has no visible position to
    // scroll to: graceful no-op, like out-of-range indexes.
    if (this.getNavigablePosition(entryIndex) === -1) {
      return;
    }
    const scroller = this.scroller ?? this.virtualizer?.getRoot();
    if (scroller == null) {
      return;
    }
    const target = this.computeRowScrollTop(
      entryIndex,
      options.align ?? 'nearest',
      scroller
    );
    if (target == null) {
      return; // nearest + already fully visible: no scroll, no re-window.
    }
    this.resolveSmoothScroller().scrollTo(target, options.behavior ?? 'auto');
  }

  /**
   * Scrolls to the first entry row dated on or after `isoDate` (rows are
   * date-sorted — the data layer's contract — so this is one binary search).
   * Dates before the first row resolve to row 0; dates after the last row
   * (and empty registers) are a graceful no-op — scrolling somewhere
   * unrelated would be worse than not moving.
   */
  scrollToDate(isoDate: string, options?: ScrollToRowOptions): void {
    const index = findFirstRowOnOrAfterDate(this.rows, isoDate);
    if (index == null) {
      return;
    }
    this.scrollToRow(index, options);
  }

  // VirtualizedInstance: translate the pixel window into a row range and
  // commit it when it changed. Range identity fully determines the DOM (the
  // window is re-derived from data every time), so an unchanged range is
  // always a no-op — even under force — which lets the Virtualizer's
  // corrected geometry pass converge instead of looping.
  onRender(windowSpecs: VirtualWindowSpecs, _force: boolean): boolean {
    // The sticky period label tracks every emitted frame (scroll moves the
    // seam even when the row window itself is unchanged); the O(log n)
    // lookup is cheap and the DOM write is gated on the group changing.
    this.updateStickyGroupLabel();
    const range = this.getRowWindow(windowSpecs);
    if (
      this.renderedRange != null &&
      this.renderedRange.start === range.start &&
      this.renderedRange.end === range.end
    ) {
      return false;
    }
    this.applyWindow(range);
    return true;
  }

  setVisibility(visible: boolean): void {
    this.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getRowHeight(): number {
    const { density = 'comfortable', lineHeight = DEFAULT_LINE_HEIGHT } =
      this.options;
    return density === 'compact' ? lineHeight : lineHeight * 2;
  }

  /**
   * Group header row height: one text line plus fixed padding, mirroring the
   * register header's density-independent shape (only entry rows scale with
   * density). Must agree with `[data-group-row]` height in style.css.
   */
  getGroupRowHeight(): number {
    const { lineHeight = DEFAULT_LINE_HEIGHT } = this.options;
    return lineHeight + GROUP_HEADER_EXTRA_HEIGHT;
  }

  getEstimatedHeight(): number {
    const {
      headerHeight = DEFAULT_HEADER_HEIGHT,
      lineHeight = DEFAULT_LINE_HEIGHT,
    } = this.options;
    // A zero-row register renders the fixed-height empty-state block in
    // place of rows; it is real flow content, so estimates must count it or
    // every section below an empty one drifts by its height. Density does
    // not scale it (the group-header precedent).
    if (this.rows.length === 0) {
      return headerHeight + lineHeight + REGISTER_EMPTY_EXTRA_HEIGHT;
    }
    const bodyHeight =
      this.rowOffsets != null
        ? this.rowOffsets[this.rowOffsets.length - 1]
        : this.rows.length * this.getRowHeight();
    return headerHeight + bodyHeight;
  }

  cleanUp(): void {
    this.disconnectVirtualizer?.();
    this.disconnectVirtualizer = undefined;
    if (this.ownsVirtualizer) {
      this.virtualizer?.cleanUp();
    }
    this.virtualizer = undefined;
    this.ownsVirtualizer = false;
    // Only the owned engine is torn down; a shared one (LedgerView's) may
    // still be animating the shared scroller for surviving sections.
    if (this.ownsSmoothScroller) {
      this.smoothScroller?.cleanUp();
    }
    this.smoothScroller = undefined;
    this.ownsSmoothScroller = false;
    this.interactionManager.cleanUp();
    this.section?.removeEventListener('keydown', this.handleKeyDown);
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.scroller = undefined;
    this.section = undefined;
    this.headerElement = undefined;
    this.spacerBefore = undefined;
    this.rowsElement = undefined;
    this.spacerAfter = undefined;
    this.rows = [];
    this.rowModel = null;
    this.rowOffsets = null;
    this.entryToModelIndex = null;
    this.modelToGroupIndex = null;
    // The active filter survives (it mirrors options), but everything
    // derived from the rows does not.
    this.filterCorpus = null;
    this.filteredEntryIndexes = null;
    this.entryToFilteredPosition = null;
    this.stickyGroupElement = undefined;
    this.stickyGroupIndex = null;
    this.renderedRange = undefined;
    this.selectedIndexes = new Set();
    this.selectionAnchor = null;
    this.selectionPrimary = null;
    this.focusedIndex = null;
    this.visible = false;
  }

  // Resolves the driving Virtualizer for the standalone paths (render /
  // hydrate): reuse the one supplied via options, or create and own one
  // rooted at this register's scroller. Virtualizer.setup is idempotent so
  // repeated render calls are safe.
  private setupOwnedVirtualizer(): void {
    if (this.scroller == null || this.section == null) {
      return;
    }
    if (this.virtualizer == null) {
      const provided = this.options.virtualizer;
      this.virtualizer = provided ?? new Virtualizer();
      this.ownsVirtualizer = provided == null;
      this.virtualizer.setup(
        this.scroller,
        this.scroller.firstElementChild ?? undefined
      );
    }
    this.disconnectVirtualizer ??= this.virtualizer.connect(this.section, this);
  }

  private createSectionElement(): HTMLElement {
    const section = document.createElement('section');
    this.populateSectionElement(section);
    return section;
  }

  // Builds the section skeleton: sticky header, the (grouped-only) sticky
  // period-label mirror, then a body holding the before-spacer, the windowed
  // rows container, and the after-spacer.
  private populateSectionElement(section: HTMLElement): void {
    const {
      account,
      density = 'comfortable',
      headerHeight = DEFAULT_HEADER_HEIGHT,
    } = this.options;
    section.setAttribute('data-register', '');
    section.setAttribute('data-density', density);
    const stickyLabel = this.isStickyGroupLabelEnabled()
      ? renderStickyGroupContainerHTML(headerHeight)
      : '';
    section.innerHTML =
      renderRegisterHeaderHTML(account, null) +
      stickyLabel +
      '<div data-register-body>' +
      '<div data-register-spacer="before" style="height: 0px"></div>' +
      '<div data-register-rows></div>' +
      '<div data-register-spacer="after" style="height: 0px"></div>' +
      '</div>';
  }

  // Takes ownership of an existing section skeleton (fresh, SSR'd, or
  // provided by LedgerView) and wires interaction delegation onto it. The
  // keydown handler lives here too — one delegated listener on the grid
  // element, mirroring the accounts tree's single-handler structure.
  private adoptSection(section: HTMLElement): void {
    this.section = section;
    this.headerElement =
      section.querySelector('[data-register-header]') ?? undefined;
    this.spacerBefore =
      section.querySelector('[data-register-spacer="before"]') ?? undefined;
    this.rowsElement =
      section.querySelector('[data-register-rows]') ?? undefined;
    this.spacerAfter =
      section.querySelector('[data-register-spacer="after"]') ?? undefined;
    const stickyGroup = section.querySelector('[data-group-sticky]');
    this.stickyGroupElement =
      stickyGroup instanceof HTMLElement ? stickyGroup : undefined;
    this.stickyGroupIndex = null;
    this.ensureStickyGroupElement();
    this.interactionManager.setup(section);
    this.updateGridAttributes();
    // Always attached; the handler gates on the CURRENT option value. A
    // mount-time gate here would desync from updateGridAttributes when
    // setOptions flips disableKeyboardNavigation at runtime — advertising a
    // focusable grid (tabindex="0") that ignores every key, or the inverse.
    section.addEventListener('keydown', this.handleKeyDown);
  }

  // (Re)derives the (grouped and/or filtered) row model + offsets. Null on
  // the 'none'-and-unfiltered path so flat registers keep the
  // pure-arithmetic windowing with zero extra allocation — the empty-query /
  // null-filter fast path is byte-for-byte today's code path.
  private rebuildRowModel(): void {
    const groupBy = this.options.groupBy ?? 'none';
    const filter = this.activeFilter;
    if (filter != null && this.rows.length > 0) {
      // Filtered projection: match against the lazy corpus (built once per
      // data version, reused across query changes), then reshape the model
      // to matched rows only — with recomputed per-period summaries when
      // grouped. Both builders keep ORIGINAL entry indexes on every row.
      this.filterCorpus ??= buildRegisterFilterCorpus(this.rows);
      const matches = computeRegisterFilterMatches(
        this.rows,
        filter,
        this.filterCorpus
      );
      this.filteredEntryIndexes = matches;
      const entryToFilteredPosition = new Int32Array(this.rows.length).fill(-1);
      for (const [position, entryIndex] of matches.entries()) {
        entryToFilteredPosition[entryIndex] = position;
      }
      this.entryToFilteredPosition = entryToFilteredPosition;
      this.rowModel = buildFilteredRegisterRowModel(
        this.rows,
        groupBy,
        matches
      );
      this.rowOffsets = computeRowModelOffsets(
        this.rowModel,
        this.getRowHeight(),
        this.getGroupRowHeight()
      );
      this.rebuildModelIndexes();
      return;
    }
    this.filteredEntryIndexes = null;
    this.entryToFilteredPosition = null;
    if (groupBy === 'none' || this.rows.length === 0) {
      this.rowModel = null;
      this.rowOffsets = null;
      this.entryToModelIndex = null;
      this.modelToGroupIndex = null;
      return;
    }
    this.rowModel = buildRegisterRowModel(this.rows, groupBy);
    this.rowOffsets = computeRowModelOffsets(
      this.rowModel,
      this.getRowHeight(),
      this.getGroupRowHeight()
    );
    this.rebuildModelIndexes();
  }

  // Inverse index for focus reveal: entryIndex → model index, one O(n)
  // pass per data update instead of a scan per keystroke (-1 marks entries
  // absent from the model, i.e. filtered out). The sibling modelToGroupIndex
  // maps every model row to its governing group header for the sticky-label
  // lookup.
  private rebuildModelIndexes(): void {
    if (this.rowModel == null) {
      return;
    }
    const entryToModelIndex = new Int32Array(this.rows.length).fill(-1);
    const modelToGroupIndex = new Int32Array(this.rowModel.length);
    let currentGroupIndex = 0;
    for (const [modelIndex, item] of this.rowModel.entries()) {
      if (item.kind === 'entry') {
        entryToModelIndex[item.entryIndex] = modelIndex;
      } else {
        currentGroupIndex = modelIndex;
      }
      modelToGroupIndex[modelIndex] = currentGroupIndex;
    }
    this.entryToModelIndex = entryToModelIndex;
    this.modelToGroupIndex = modelToGroupIndex;
  }

  // Rebuilds the visible projection in place after a filter (or grouped
  // reshape) change: new model, fresh window, honest ARIA counts, sticky
  // label re-derive — and the filter's contract on focus/selection. The
  // filter never mutates selection (hidden selected rows simply are not
  // rendered), but a focused row that got filtered out clears SILENTLY
  // (aria-activedescendant is removed by the window commit): this is a
  // projection change, not a navigation event, so onFocusChange stays quiet
  // — the setRows clamping precedent.
  private reprojectRows(): void {
    this.rebuildRowModel();
    this.renderedRange = undefined;
    if (
      this.focusedIndex != null &&
      this.getNavigablePosition(this.focusedIndex) === -1
    ) {
      this.getRowElement(this.focusedIndex)?.removeAttribute('data-focused');
      this.focusedIndex = null;
    }
    this.updateGridAttributes();
    this.applyWindow(this.getRowWindow(this.virtualizer?.getWindowSpecs()));
    this.stickyGroupIndex = null;
    this.updateStickyGroupLabel();
    this.virtualizer?.instanceChanged();
    this.emitFilterResult();
  }

  // Fires onFilterResult for the current ACTIVE filter application; clears
  // fire nothing (documented on the option).
  private emitFilterResult(): void {
    const { onFilterResult } = this.options;
    if (onFilterResult == null || this.activeFilter == null) {
      return;
    }
    onFilterResult({
      matched: this.filteredEntryIndexes?.length ?? 0,
      total: this.rows.length,
    });
  }

  /** Rows keyboard navigation can land on: matched rows under a filter,
   * every entry row otherwise. */
  private getNavigableRowCount(): number {
    return this.filteredEntryIndexes != null
      ? this.filteredEntryIndexes.length
      : this.rows.length;
  }

  // Visible position → entry index: identity without a filter (the original
  // flat arithmetic), one array lookup with one.
  private getEntryIndexAtNavigablePosition(position: number): number {
    return this.filteredEntryIndexes != null
      ? this.filteredEntryIndexes[position]
      : position;
  }

  // Entry index → visible position; -1 when an active filter hides the row.
  private getNavigablePosition(entryIndex: number): number {
    return this.entryToFilteredPosition != null
      ? this.entryToFilteredPosition[entryIndex]
      : entryIndex;
  }

  private getRowWindow(windowSpecs: VirtualWindowSpecs | undefined): RowRange {
    const {
      headerHeight = DEFAULT_HEADER_HEIGHT,
      overscanRows = DEFAULT_OVERSCAN_ROWS,
      getOffsetTop,
    } = this.options;
    const bodyTop = (getOffsetTop?.() ?? 0) + headerHeight;
    if (this.rowModel == null || this.rowOffsets == null) {
      return computeRowWindow({
        windowSpecs: windowSpecs ?? { top: 0, bottom: 0 },
        bodyTop,
        rowHeight: this.getRowHeight(),
        rowCount: this.rows.length,
        overscanRows,
      });
    }
    return computeGroupedRowWindow({
      windowSpecs: windowSpecs ?? { top: 0, bottom: 0 },
      bodyTop,
      offsets: this.rowOffsets,
      overscanRows,
    });
  }

  // Commits a row window: one innerHTML write for the rows plus two spacer
  // height writes. Rebuilding the whole window is intentionally simple — the
  // window is bounded (~viewport + 2 * overscan rows), so no element pooling
  // is needed to stay comfortably within frame budget.
  private applyWindow(range: RowRange): void {
    const { spacerBefore, rowsElement, spacerAfter } = this;
    if (spacerBefore == null || rowsElement == null || spacerAfter == null) {
      return;
    }
    if (this.rowOffsets != null && this.rowModel != null) {
      // Grouped: spacer heights come straight from the prefix sums.
      const offsets = this.rowOffsets;
      const total = offsets[offsets.length - 1];
      spacerBefore.style.setProperty('height', `${offsets[range.start]}px`);
      spacerAfter.style.setProperty(
        'height',
        `${total - offsets[range.end]}px`
      );
    } else {
      const rowHeight = this.getRowHeight();
      spacerBefore.style.setProperty('height', `${range.start * rowHeight}px`);
      spacerAfter.style.setProperty(
        'height',
        `${(this.rows.length - range.end) * rowHeight}px`
      );
    }
    this.renderedRange = range;

    // Zero rows: commit the designed empty state instead of a bare header
    // over nothing — the same bytes renderRegisterHTML emits for SSR, so
    // hydration adoption stays a no-op rewrite. Always synchronous and never
    // through the worker pool (there is no row window to build); the version
    // bump invalidates any in-flight worker window from a previous non-empty
    // dataset so a stale response cannot clobber the block.
    if (this.rows.length === 0) {
      this.windowRenderVersion += 1;
      rowsElement.innerHTML = renderRegisterEmptyStateHTML(
        this.options.emptyLabel
      );
      return;
    }

    const pool = this.options.workerPool;
    if (pool == null || !pool.isWorkingPool()) {
      rowsElement.innerHTML = this.renderWindowHTMLSync(range);
      this.patchFocusAttributes();
      return;
    }

    // Worker path: spacers above are already committed (so scrollHeight and
    // scroll position hold steady), the row HTML resolves off-thread and is
    // applied on the next animation frame. A version stamp drops responses
    // for windows the user has already scrolled past.
    const version = ++this.windowRenderVersion;
    const { rows, activeFilter } = this;
    const groupBy = this.options.groupBy ?? 'none';
    // Flat, unfiltered windows depend only on the rows inside the range —
    // running balances are precomputed per row and every index-derived byte
    // comes from the absolute index rowsOffset restores — so the worker gets
    // just the visible slice instead of a structured clone of the whole
    // dataset (O(window) per request, not O(dataset)). Grouped/filtered
    // paths still need full rows: the worker rebuilds group summaries and
    // filter matches over the entire dataset. The cache key already carries
    // rowsVersion + range, which fully determines the slice's contents.
    const isFlatWindow = groupBy === 'none' && activeFilter == null;
    const windowRows = isFlatWindow ? rows.slice(range.start, range.end) : rows;
    const rowsOffset = isFlatWindow ? range.start : 0;
    const selectedIndexes = this.getSortedSelection();
    // The filter segment sits LAST in the cache key: the query is raw user
    // text and may contain ':', so trailing position keeps it from forging
    // any other key segment.
    const filterKey =
      activeFilter != null
        ? `${(activeFilter.fields ?? ['description']).join('_')}|${activeFilter.query}`
        : 'nofilter';
    void pool
      .renderRegisterWindow({
        rows: windowRows,
        range,
        rowsOffset,
        selectedIndex: this.selectionPrimary,
        selectedIndexes,
        groupBy,
        // Focus is NOT baked into window HTML (it is patched post-commit),
        // but row ids are — thread the prefix so worker bytes match sync.
        idPrefix: this.instanceId,
        // The filter crosses the protocol too: the worker rebuilds the
        // same filtered model so its bytes match the sync path.
        filter: activeFilter,
        cacheKey:
          `${this.workerInstanceId}:${this.rowsVersion}:${groupBy}:` +
          `${range.start}:${range.end}:` +
          `${selectedIndexes.length > 0 ? selectedIndexes.join('_') : 'none'}:` +
          filterKey,
      })
      .then((html) => {
        if (version !== this.windowRenderVersion || this.rowsElement == null) {
          return;
        }
        queueRender(() => {
          if (
            version !== this.windowRenderVersion ||
            this.rowsElement == null
          ) {
            return;
          }
          this.rowsElement.innerHTML = html;
          this.patchFocusAttributes();
        });
      })
      .catch(() => {
        // Pool terminated (or rejected) mid-flight: fall back to the sync
        // renderer if this window is still the one we want.
        if (version !== this.windowRenderVersion || this.rowsElement == null) {
          return;
        }
        this.rowsElement.innerHTML = this.renderWindowHTMLSync(range);
        this.patchFocusAttributes();
      });
  }

  // Sync window HTML from the cached row model (grouped and/or filtered) or
  // the flat rows. Byte-identical to the worker output: the worker rebuilds
  // the same model from the same rows/filter with the same pure functions.
  private renderWindowHTMLSync(range: RowRange): string {
    const selected =
      this.selectedIndexes.size > 0 ? this.selectedIndexes : null;
    if (this.rowModel != null) {
      return renderRegisterVirtualRowsHTML(
        this.rowModel,
        range,
        selected,
        this.instanceId,
        this.activeFilter
      );
    }
    return renderRegisterRowsHTML(this.rows, range, selected, this.instanceId);
  }

  private getSortedSelection(): number[] {
    return [...this.selectedIndexes].sort((a, b) => a - b);
  }

  private getRowElement(index: number): HTMLElement | undefined {
    const row = this.section?.querySelector(`[data-row-index="${index}"]`);
    return row instanceof HTMLElement ? row : undefined;
  }

  // Applies the delta between the previous and current selection to the live
  // DOM. Rows outside the rendered window simply resolve to no element; they
  // pick their attribute up from the next window render, which is how
  // selection survives re-windowing. aria-selected is patched alongside the
  // styling attribute so assistive tech and CSS can never disagree.
  private patchSelectionAttributes(previous: ReadonlySet<number>): void {
    for (const index of previous) {
      if (!this.selectedIndexes.has(index)) {
        const row = this.getRowElement(index);
        row?.removeAttribute('data-row-selected');
        row?.setAttribute('aria-selected', 'false');
      }
    }
    for (const index of this.selectedIndexes) {
      if (!previous.has(index)) {
        const row = this.getRowElement(index);
        row?.setAttribute('data-row-selected', 'true');
        row?.setAttribute('aria-selected', 'true');
      }
    }
  }

  // Pointer-driven selection. Group header rows never reach here: they carry
  // no [data-row]/[data-row-index], so the InteractionManager's delegated
  // click handler cannot resolve them to an index.
  private handleRowSelect = (
    index: number,
    modifiers: RowSelectModifiers
  ): void => {
    const row = this.rows[index];
    if (row == null) {
      return;
    }
    // Selecting a row (pointer click or Enter/Space) also focuses it so
    // keyboard navigation continues from where the user clicked. The row is
    // already in the rendered window (it was hit-tested), so no reveal.
    this.setFocusedIndex(index, { reveal: false });
    const mode = this.options.selectionMode ?? 'single';
    if (mode === 'single') {
      this.setSelectedRow(index);
      this.options.onRowSelect?.(row, index);
      this.emitSelectionChange();
      return;
    }
    const previous = this.selectedIndexes;
    if (modifiers.shiftKey && this.selectionAnchor != null) {
      // Contiguous anchor→target range in entry-index space; the anchor
      // stays put so repeated shift-clicks re-extend from the same origin.
      const low = Math.min(this.selectionAnchor, index);
      const high = Math.max(this.selectionAnchor, index);
      const next = new Set<number>();
      for (let entryIndex = low; entryIndex <= high; entryIndex += 1) {
        next.add(entryIndex);
      }
      this.selectedIndexes = next;
    } else if (modifiers.metaKey || modifiers.ctrlKey) {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
        // Removing the anchor row leaves no sensible origin; clear it so a
        // stray shift-click cannot extend from a deselected row.
        if (this.selectionAnchor === index) {
          this.selectionAnchor = null;
        }
      } else {
        next.add(index);
        this.selectionAnchor = index;
      }
      this.selectedIndexes = next;
    } else {
      this.selectedIndexes = new Set([index]);
      this.selectionAnchor = index;
    }
    this.selectionPrimary = index;
    this.patchSelectionAttributes(previous);
    this.options.onRowSelect?.(row, index);
    this.emitSelectionChange();
  };

  /**
   * Grid-level ARIA state on the section element, mirroring what
   * renderRegisterHTML emits for SSR (the design decisions are documented
   * there). Called whenever an input feeding it changes: mount, setRows
   * (aria-rowcount), setOptions (label / selectionMode / groupBy).
   */
  private updateGridAttributes(): void {
    const { section } = this;
    if (section == null) {
      return;
    }
    section.setAttribute('role', 'grid');
    section.setAttribute(
      'aria-label',
      this.options.label ?? this.options.account
    );
    section.setAttribute(
      'aria-rowcount',
      String(this.rowModel != null ? this.rowModel.length : this.rows.length)
    );
    if ((this.options.selectionMode ?? 'single') === 'range') {
      section.setAttribute('aria-multiselectable', 'true');
    } else {
      section.removeAttribute('aria-multiselectable');
    }
    if (this.options.disableKeyboardNavigation !== true) {
      section.setAttribute('tabindex', '0');
    } else {
      section.removeAttribute('tabindex');
    }
  }

  // The whole keyboard map in one delegated handler on the grid element
  // (the accounts tree structure). Navigation lives in ENTRY-index space —
  // the same space as selection — so group header rows are skipped without
  // any bookkeeping: they simply have no entry index.
  private handleKeyDown = (event: Event): void => {
    // Checked per event, not at listener-attach time, so runtime option
    // flips via setOptions take effect immediately (see adoptSection).
    if (this.options.disableKeyboardNavigation === true) {
      return;
    }
    const keyboard = event as KeyboardEvent;
    // IME guard, first thing: keys consumed by an active composition
    // (Enter confirms a candidate, Escape dismisses one) must never drive
    // navigation or selection.
    if (isComposingEvent(keyboard)) {
      return;
    }
    // All movement math runs in VISIBLE-position space: matched rows under
    // an active filter (keyboard navigation walks filtered rows only),
    // every entry row otherwise — where position === entry index and this
    // is exactly the original arithmetic.
    const rowCount = this.getNavigableRowCount();
    if (rowCount === 0) {
      return;
    }
    const { key } = keyboard;
    const mode = this.options.selectionMode ?? 'single';

    if (
      (keyboard.metaKey || keyboard.ctrlKey) &&
      (key === 'a' || key === 'A')
    ) {
      if (mode !== 'range') {
        return; // Single mode: leave the browser's select-all alone.
      }
      keyboard.preventDefault();
      this.selectAllRows();
      return;
    }

    if (key === 'Escape') {
      if (this.selectedIndexes.size === 0) {
        return; // Nothing selected: no callback, no preventDefault.
      }
      keyboard.preventDefault();
      const previous = this.selectedIndexes;
      this.selectedIndexes = new Set();
      this.selectionAnchor = null;
      this.selectionPrimary = null;
      this.patchSelectionAttributes(previous);
      this.emitSelectionChange();
      return;
    }

    if (key === 'Enter' || key === ' ') {
      if (this.focusedIndex == null) {
        return;
      }
      keyboard.preventDefault();
      // Exactly a plain click on the focused row: single mode replaces the
      // selection, range mode selects and sets the anchor — one code path,
      // so pointer and keyboard can never drift apart.
      this.handleRowSelect(this.focusedIndex, {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      });
      return;
    }

    // Movement keys. `base` is where movement starts: the focused row,
    // falling back to the primary selection so keyboard picks up from a
    // pre-existing pointer selection, then to "before the first row". A
    // base row hidden by the filter resolves to no position, so movement
    // restarts from the grid edge — same as having no focus at all.
    const baseEntry = this.focusedIndex ?? this.selectionPrimary;
    const basePosition =
      baseEntry != null ? this.getNavigablePosition(baseEntry) : -1;
    const base = basePosition >= 0 ? basePosition : null;
    let target: number;
    switch (key) {
      case 'ArrowDown': {
        if (base != null && base >= rowCount - 1 && !keyboard.shiftKey) {
          // Edge of this register: offer the focus to the host (LedgerView
          // moves it to the next section) before clamping in place.
          if (this.options.onFocusBoundary?.(1) === true) {
            keyboard.preventDefault();
            this.setFocusedIndex(null);
            return;
          }
        }
        target = Math.min(rowCount - 1, (base ?? -1) + 1);
        break;
      }
      case 'ArrowUp': {
        if (base != null && base <= 0 && !keyboard.shiftKey) {
          if (this.options.onFocusBoundary?.(-1) === true) {
            keyboard.preventDefault();
            this.setFocusedIndex(null);
            return;
          }
        }
        target = Math.max(0, (base ?? rowCount) - 1);
        break;
      }
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = rowCount - 1;
        break;
      case 'PageDown':
        target = Math.min(rowCount - 1, (base ?? -1) + this.getPageSize());
        break;
      case 'PageUp':
        target = Math.max(0, (base ?? rowCount) - this.getPageSize());
        break;
      default:
        return;
    }
    keyboard.preventDefault(); // Arrows/paging must never scroll the page.
    // Translate the visible position back into the entry index — the only
    // space focus, selection, and callbacks ever speak.
    const targetEntryIndex = this.getEntryIndexAtNavigablePosition(target);
    this.setFocusedIndex(targetEntryIndex);
    if (
      keyboard.shiftKey &&
      mode === 'range' &&
      (key === 'ArrowDown' || key === 'ArrowUp')
    ) {
      // Shift+Arrow IS a shift-click on the new row: the shared pointer
      // path guarantees identical RegisterSelection states. (Under a
      // filter the anchor→target range stays contiguous in ENTRY-index
      // space — selection identity never depends on the projection.)
      this.handleRowSelect(targetEntryIndex, {
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      });
    }
  };

  // Meta/Ctrl+A (range mode): every VISIBLE entry row — all rows without a
  // filter, matched rows with one ("select all" acts on what the grid
  // presents; silently selecting hidden rows would be a trap). The anchor
  // is preserved (or seeded at the first visible row) so a following
  // Shift+Arrow still has an origin.
  private selectAllRows(): void {
    const previous = this.selectedIndexes;
    const next = new Set<number>();
    const count = this.getNavigableRowCount();
    for (let position = 0; position < count; position += 1) {
      next.add(this.getEntryIndexAtNavigablePosition(position));
    }
    this.selectedIndexes = next;
    this.selectionAnchor ??=
      count > 0 ? this.getEntryIndexAtNavigablePosition(0) : 0;
    this.patchSelectionAttributes(previous);
    this.emitSelectionChange();
  }

  /**
   * Single writer for focus state: patches `data-focused` in the live DOM,
   * repoints aria-activedescendant, optionally reveals the row, and fires
   * onFocusChange. Rows outside the rendered window resolve to no element
   * and pick their attribute up from the next window commit
   * (patchFocusAttributes), exactly like selection.
   */
  private setFocusedIndex(
    index: number | null,
    { reveal = true }: { reveal?: boolean } = {}
  ): void {
    const previous = this.focusedIndex;
    this.focusedIndex = index;
    if (previous != null && previous !== index) {
      this.getRowElement(previous)?.removeAttribute('data-focused');
    }
    if (index != null) {
      if (reveal) {
        this.revealRow(index);
      }
      this.getRowElement(index)?.setAttribute('data-focused', 'true');
    }
    this.updateActiveDescendant();
    if (previous !== index) {
      this.options.onFocusChange?.(
        index,
        index != null ? (this.rows[index] ?? null) : null
      );
    }
  }

  // Re-applies focus state to a freshly committed window: innerHTML writes
  // rebuild rows without the (deliberately un-baked) data-focused attribute,
  // and eviction/re-entry must also update aria-activedescendant.
  private patchFocusAttributes(): void {
    if (this.focusedIndex != null) {
      this.getRowElement(this.focusedIndex)?.setAttribute(
        'data-focused',
        'true'
      );
    }
    this.updateActiveDescendant();
  }

  // aria-activedescendant points at the focused row's stable id while that
  // row is materialized, and is REMOVED while virtualization has evicted it
  // — an honest signal that the referenced element does not exist (the
  // accounts tree idiom).
  private updateActiveDescendant(): void {
    const { section } = this;
    if (section == null) {
      return;
    }
    if (
      this.focusedIndex != null &&
      this.getRowElement(this.focusedIndex) != null
    ) {
      section.setAttribute(
        'aria-activedescendant',
        `${this.instanceId}-row-${this.focusedIndex}`
      );
    } else {
      section.removeAttribute('aria-activedescendant');
    }
  }

  /** Sticky period labels default ON whenever grouping is active. */
  private isStickyGroupLabelEnabled(): boolean {
    return (
      (this.options.groupBy ?? 'none') !== 'none' &&
      this.options.stickyGroupLabels !== false
    );
  }

  /**
   * Reconciles the sticky mirror container with the current groupBy state:
   * creates it (just after the sticky header, pinned `headerHeight` below
   * the viewport top) when grouping turned on, removes it when grouping
   * turned off. Idempotent, so mount/adopt/setOptions can all call it.
   */
  private ensureStickyGroupElement(): void {
    const { section } = this;
    if (section == null) {
      return;
    }
    const enabled = this.isStickyGroupLabelEnabled();
    if (!enabled) {
      this.stickyGroupElement?.remove();
      this.stickyGroupElement = undefined;
      this.stickyGroupIndex = null;
      return;
    }
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    if (this.stickyGroupElement == null) {
      const template = document.createElement('div');
      template.innerHTML = renderStickyGroupContainerHTML(headerHeight);
      const element = template.firstElementChild;
      if (!(element instanceof HTMLElement)) {
        return;
      }
      // Insert between the header and the body so position:sticky pins it
      // right below the header within this section's bounds.
      (this.headerElement ?? section.firstElementChild)?.after(element);
      this.stickyGroupElement = element;
    } else {
      // Re-pin: an adopted SSR container carries the default header height.
      this.stickyGroupElement.style.setProperty('top', `${headerHeight}px`);
    }
  }

  /**
   * Updates the sticky period label from the row at the seam just below the
   * sticky section header. The seam's offset into the body is simply
   * `scrollTop - sectionOffset` (both header heights cancel out), the row
   * containing it is one binary search over the prefix sums, and its
   * governing group is an O(1) table lookup. The mirror shows only once the
   * group's real header row has started to scroll UNDER the seam — before
   * that the real row is fully visible and a mirror would double it.
   */
  private updateStickyGroupLabel(): void {
    const element = this.stickyGroupElement;
    if (element == null) {
      return;
    }
    const { rowModel, rowOffsets, modelToGroupIndex } = this;
    const scroller = this.scroller ?? this.virtualizer?.getRoot();
    if (
      rowModel == null ||
      rowOffsets == null ||
      modelToGroupIndex == null ||
      scroller == null
    ) {
      this.hideStickyGroupLabel(element);
      return;
    }
    const seamOffset =
      scroller.scrollTop - (this.options.getOffsetTop?.() ?? 0);
    if (seamOffset <= 0) {
      this.hideStickyGroupLabel(element);
      return;
    }
    const modelIndex = findRowIndexAtOffset(rowOffsets, seamOffset);
    if (modelIndex < 0) {
      this.hideStickyGroupLabel(element);
      return;
    }
    const groupIndex = modelToGroupIndex[modelIndex];
    if (seamOffset <= rowOffsets[groupIndex]) {
      // The governing group header row sits exactly at (or below) the seam:
      // fully visible, so the mirror stays hidden.
      this.hideStickyGroupLabel(element);
      return;
    }
    if (groupIndex === this.stickyGroupIndex) {
      return; // Same period as last frame: nothing to write.
    }
    const item = rowModel[groupIndex];
    if (item.kind !== 'group') {
      this.hideStickyGroupLabel(element);
      return;
    }
    this.stickyGroupIndex = groupIndex;
    element.innerHTML = renderStickyGroupLabelHTML(item.group);
    element.hidden = false;
  }

  private hideStickyGroupLabel(element: HTMLElement): void {
    if (this.stickyGroupIndex == null && element.hidden === true) {
      return;
    }
    this.stickyGroupIndex = null;
    element.hidden = true;
  }

  /**
   * Focus reveal: brings the focused entry row fully into the viewport with
   * minimal movement (`block: 'nearest'` semantics) through the scroll
   * engine's instant path. `behavior: 'auto'` on purpose — reveal answers a
   * keystroke, and an animated reveal would lag typing; smooth scrolling
   * stays opt-in on the public scrollToRow/scrollToDate/section APIs.
   */
  private revealRow(entryIndex: number): void {
    this.scrollToRow(entryIndex, { align: 'nearest', behavior: 'auto' });
  }

  /**
   * Target scrollTop for an alignment, or null when `nearest` finds the row
   * already fully visible. `start`/`nearest`-upward subtract the sticky
   * header height because the sticky header overlays the viewport top —
   * without it the row would land hidden beneath the header. Targets clamp
   * to the scrollable range so the spring never chases an unreachable
   * position (skipped when the environment reports no scrollHeight, e.g.
   * unstubbed jsdom).
   */
  private computeRowScrollTop(
    entryIndex: number,
    align: 'start' | 'center' | 'nearest',
    scroller: HTMLElement
  ): number | null {
    const { headerHeight = DEFAULT_HEADER_HEIGHT, getOffsetTop } = this.options;
    const bodyTop = (getOffsetTop?.() ?? 0) + headerHeight;
    const rowHeight = this.getRowHeight();
    // -1 marks entries absent from the model (filtered out); callers guard
    // already, but a scroll target of NaN must never be computable.
    if (
      this.entryToModelIndex != null &&
      this.entryToModelIndex[entryIndex] < 0
    ) {
      return null;
    }
    const rowTop =
      this.rowOffsets != null && this.entryToModelIndex != null
        ? bodyTop + this.rowOffsets[this.entryToModelIndex[entryIndex]]
        : bodyTop + entryIndex * rowHeight;
    const viewportHeight = this.getViewportHeight(scroller);
    let target: number;
    if (align === 'start') {
      target = rowTop - headerHeight;
    } else if (align === 'center') {
      target = rowTop + rowHeight / 2 - viewportHeight / 2;
    } else if (rowTop < scroller.scrollTop + headerHeight) {
      target = rowTop - headerHeight;
    } else if (rowTop + rowHeight > scroller.scrollTop + viewportHeight) {
      target = rowTop + rowHeight - viewportHeight;
    } else {
      return null;
    }
    const maxScrollTop =
      scroller.scrollHeight > 0
        ? Math.max(0, scroller.scrollHeight - viewportHeight)
        : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(target, maxScrollTop));
  }

  // Resolves the scroll engine like setupOwnedVirtualizer resolves the
  // Virtualizer: prefer the shared instance from options (LedgerView passes
  // one per scroll container), else lazily create and own one bound to
  // whichever scroller this register renders into.
  private resolveSmoothScroller(): SmoothScroller {
    if (this.smoothScroller == null) {
      const provided = this.options.smoothScroller;
      this.smoothScroller =
        provided ??
        new SmoothScroller(() => this.scroller ?? this.virtualizer?.getRoot(), {
          settings: this.options.smoothScrollSettings,
          // Re-window from the animated position every frame even where
          // programmatic scrollTop writes fire no scroll event (jsdom).
          onScrollFrame: () => this.virtualizer?.instanceChanged(),
        });
      this.ownsSmoothScroller = provided == null;
    }
    return this.smoothScroller;
  }

  // Viewport height for paging/reveal math; jsdom and pre-layout mounts
  // report 0, which falls back to a plausible default so keyboard paging
  // always moves a sensible amount.
  private getViewportHeight(scroller: HTMLElement): number {
    const height = scroller.getBoundingClientRect().height;
    return height > 0 ? height : DEFAULT_VIEWPORT_HEIGHT;
  }

  // PageUp/PageDown stride: one viewport's worth of ENTRY rows (below the
  // sticky header), never less than one row. Group headers make this an
  // approximation under grouping — acceptable: paging is a coarse gesture.
  private getPageSize(): number {
    const scroller = this.scroller ?? this.virtualizer?.getRoot();
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    const viewportHeight =
      scroller != null
        ? this.getViewportHeight(scroller)
        : DEFAULT_VIEWPORT_HEIGHT;
    return Math.max(
      1,
      Math.floor((viewportHeight - headerHeight) / this.getRowHeight())
    );
  }

  private emitSelectionChange(): void {
    const { onSelectionChange } = this.options;
    if (onSelectionChange == null) {
      return;
    }
    const indexes = this.getSortedSelection();
    onSelectionChange({
      indexes,
      rows: indexes.map((index) => this.rows[index]),
    });
  }
}

// An empty query IS "no filter": normalizing to null here lets every
// consumer (model rebuild, keyboard nav, worker requests) gate on a single
// nullable field, and guarantees the empty-query path is byte-for-byte the
// unfiltered fast path — no corpus, no filtered-model allocation.
function normalizeRegisterFilter(
  filter: RegisterFilter | null | undefined
): RegisterFilter | null {
  if (filter == null || filter.query === '') {
    return null;
  }
  return filter;
}
