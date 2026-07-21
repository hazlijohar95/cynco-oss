import {
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_VIEWPORT_HEIGHT,
  JOURNALS_TAG_NAME,
  REGISTER_EMPTY_EXTRA_HEIGHT,
} from '../constants';
import type {
  AmountFormat,
  ColorScheme,
  RegisterDensity,
  RegisterRowData,
  ScrollToRowOptions,
  SmoothScrollSettings,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { areRegisterRowArraysEqual } from '../utils/areRegisterRowArraysEqual';
import { SmoothScroller } from '../utils/SmoothScroller';
import { Register } from './Register';
import { Virtualizer } from './Virtualizer';
import { JournalsContainerLoaded } from './web-components';

export interface LedgerSection {
  /**
   * Canonical colon-delimited account path for this register section. Also
   * the RECONCILIATION KEY: setSections matches sections to live Register
   * instances by account path, so paths must be unique within one view.
   */
  account: string;
  rows: readonly RegisterRowData[];
}

export interface LedgerViewOptions {
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
  /** Row density shared by every section. Default `comfortable`. */
  density?: RegisterDensity;
  /** See {@link Register} — must match `--journals-line-height`. Default 20. */
  lineHeight?: number;
  /** See {@link Register} — must match the header CSS min-height. Default 44. */
  headerHeight?: number;
  /** Extra rows rendered above/below the window per section. Default 10. */
  overscanRows?: number;
  /**
   * Stable view id threaded into per-section ARIA row ids. Required for
   * SSR: pass the same id to `preloadLedgerViewHTML` so the hydrated client
   * reproduces the ids the preload emitted (the Register/AccountTree id
   * contract). Auto-generated when omitted (client-only rendering).
   */
  id?: string;
  /**
   * Guidance text for zero-row sections (see RegisterRenderOptions
   * .emptyLabel), shared by every section. Pass the same value to
   * `preloadLedgerViewHTML` so SSR emits the bytes the hydrated client
   * would write.
   */
  emptyLabel?: string;
  /**
   * Amount separators/grouping shared by every section (see
   * RegisterRenderOptions.amountFormat). Pass the same descriptor to
   * `preloadLedgerViewHTML` so SSR emits the bytes the hydrated client
   * would write. Default: the original `1,234.56` bytes.
   */
  amountFormat?: AmountFormat;
  /** Spring tuning for the shared smooth-scroll engine (one per view). */
  smoothScrollSettings?: SmoothScrollSettings;
  /** Fired when any row is clicked, with the owning account path. */
  onRowSelect?(account: string, row: RegisterRowData, index: number): void;
}

export interface LedgerViewRenderProps {
  sections: readonly LedgerSection[];
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

export interface LedgerViewHydrateProps {
  sections: readonly LedgerSection[];
  /** Container whose (declarative) shadow root already holds SSR output
   * from `preloadLedgerViewHTML`. */
  container: HTMLElement;
}

/**
 * One live section: the Register instance, its `<section>` element, the rows
 * it was last given, and its CURRENT position in section order. Register
 * option closures (getOffsetTop / onRowSelect / onFocusBoundary) read
 * `index` through this record so reconciliation can reorder sections
 * without recreating instances or re-binding callbacks.
 */
interface MountedLedgerSection {
  account: string;
  register: Register;
  element: HTMLElement;
  rows: readonly RegisterRowData[];
  index: number;
}

/**
 * Scroll anchor captured before a setSections reconciliation: the topmost
 * visible section, the entry row at the viewport top within it, and where
 * that anchor sat relative to the viewport — enough to recompute the
 * scrollTop that keeps the same content pixel-stable after sections above
 * it grow, shrink, appear, or disappear.
 */
interface LedgerScrollAnchor {
  scrollTop: number;
  /** Account of the topmost visible section (null for an empty view). */
  account: string | null;
  /** Old section order, for the nearest-surviving-neighbor fallback walk. */
  accounts: readonly string[];
  /** Old order index of the anchor section. */
  orderIndex: number;
  /** Entry row at the viewport top, or null when the header band was there. */
  entryIndex: number | null;
  /** anchor row/section top minus scrollTop (px). */
  viewportOffset: number;
  /** OLD anchor-section top minus scrollTop, for the neighbor fallback. */
  sectionViewportOffset: number;
}

let ledgerViewInstanceCount = -1;

// The CodeView analog, v2: one scroll container stacking a Register per
// account with sticky section headers, all driven by a single shared
// Virtualizer and a single shared SmoothScroller. Section offsets are
// estimated from row counts (fixed row heights make estimates exact), so no
// layout reads are needed to place windows. setSections reconciles
// incrementally (keyed by account path) and anchors the scroll position to
// the content the user is looking at.
export class LedgerView {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private scroller: HTMLElement | undefined;
  private content: HTMLElement | undefined;
  private virtualizer: Virtualizer | undefined;
  private smoothScroller: SmoothScroller | undefined;
  private sections: readonly LedgerSection[] = [];
  /** Live sections in current visual order (aligned with `sections`). */
  private order: MountedLedgerSection[] = [];
  /** account path → live section (first mount wins on duplicate paths). */
  private mounted = new Map<string, MountedLedgerSection>();
  /**
   * Estimated pixel offset of each section top within the scroll content:
   * offsets[i] = Σ over j<i of (headerHeight + rowCount(j) * rowHeight).
   * Precomputed once per data update so per-frame window math is O(1) per
   * section instead of re-summing (no accidental O(n²)).
   */
  private sectionOffsets: number[] = [];
  /**
   * Stable id prefix for per-section ARIA row ids. Section ids are
   * `{viewId}-s{serial}` where the serial increments per MOUNT, not per
   * position: ids must stay fixed for a Register's lifetime (they are baked
   * into row markup), so reorders keep ids and only NEW sections consume
   * fresh serials. Because both `preloadLedgerViewHTML` and the first
   * client mount assign serials in initial section order, SSR and hydrated
   * ids agree by construction.
   */
  private readonly viewId: string;
  private nextSectionSerial = 0;

  constructor(
    public options: LedgerViewOptions = {},
    private isContainerManaged = false
  ) {
    this.viewId = options.id ?? `ledger-${++ledgerViewInstanceCount}`;
  }

  setOptions(options: LedgerViewOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  render({ sections, container, parentNode }: LedgerViewRenderProps): void {
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
      scroller.setAttribute('data-ledger-view', '');
      const content = document.createElement('div');
      content.setAttribute('data-journals-content', '');
      scroller.appendChild(content);
      shadowRoot.appendChild(scroller);
      this.adoptScroller(scroller, content);
    }
    this.setSections(sections);
  }

  // Adopts SSR output from preloadLedgerViewHTML (scroller/content/sections
  // already inside the shadow root) with zero DOM rebuilds: each section
  // element is handed to a Register via hydrateSection, and the preloaded
  // rows stay untouched until the first virtualized pass re-windows them.
  // Falls back to render when the markup is missing (the Register.hydrate
  // idiom), so callers can use hydrate unconditionally.
  hydrate({ sections, container }: LedgerViewHydrateProps): void {
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const scroller = shadowRoot.querySelector('[data-scroller]');
    const content = scroller?.querySelector('[data-journals-content]');
    if (
      !(scroller instanceof HTMLElement) ||
      !(content instanceof HTMLElement)
    ) {
      this.render({ sections, container });
      return;
    }
    this.adoptScroller(scroller, content);
    this.sections = sections;
    this.sectionOffsets = this.computeSectionOffsets(sections);
    this.order = [];
    this.mounted = new Map();

    // Pair preloaded section elements with section data in order — the same
    // order preload emitted them, which is also the order serials (and thus
    // ARIA id prefixes) are assigned in, so ids agree without coordination.
    const elements = Array.from(content.querySelectorAll('[data-register]'));
    for (const [index, section] of sections.entries()) {
      const element = elements[index];
      const entry = this.createMountedSection(section, index);
      if (element instanceof HTMLElement && this.virtualizer != null) {
        entry.element = element;
        entry.register.hydrateSection({
          rows: section.rows,
          section: element,
          virtualizer: this.virtualizer,
        });
      } else {
        // More sections than preloaded markup: mount the extras fresh.
        content.appendChild(entry.element);
        this.mountSectionElement(entry);
      }
      this.order.push(entry);
      if (!this.mounted.has(entry.account)) {
        this.mounted.set(entry.account, entry);
      }
    }
    // Fewer sections than preloaded markup: drop the excess elements.
    for (let index = sections.length; index < elements.length; index += 1) {
      elements[index].remove();
    }
    this.virtualizer?.instanceChanged();
  }

  /**
   * Incremental reconciliation, keyed by account path. The contract:
   * - Unchanged sections (same account, structurally equal rows) keep their
   *   Register instance AND their DOM untouched.
   * - Data-changed sections keep their instance and update rows in place
   *   (structural equality via the honest areRegisterRowArraysEqual, so
   *   fresh-but-identical arrays from immutable stores are "unchanged").
   * - Added sections mount; removed sections clean up and leave the DOM.
   * - Order changes reorder the existing <section> elements without
   *   recreating instances (closures read the section index live).
   * - Focused/selected rows are per-Register state keyed by entry index, so
   *   they survive whenever their section survives.
   * Scroll anchoring replaces v1's raw scrollTop preservation: the content
   * at the viewport top before the update is still at the viewport top
   * after it, whatever happened to the sections above (see
   * restoreScrollAnchor for the fallback ladder when the anchor section
   * itself was removed).
   */
  setSections(sections: readonly LedgerSection[]): void {
    // Reference bail-out (the Register.setRows idiom): the React adapter
    // calls this on every committed render, and a same-reference array
    // cannot carry changes — skipping avoids the anchor capture/restore
    // pass and, worse, canceling an in-flight smooth scroll for nothing.
    // Sections are treated as immutable; pass a fresh array to reconcile.
    if (sections === this.sections) {
      return;
    }
    const { scroller, content, virtualizer } = this;
    if (scroller == null || content == null || virtualizer == null) {
      return;
    }
    // An in-flight smooth scroll targets coordinates in the OLD geometry;
    // reconciliation invalidates them, so the animation yields to anchoring.
    this.smoothScroller?.cancel();
    const anchor = this.captureScrollAnchor(scroller);

    const previousOrder = this.order;
    const nextOrder: MountedLedgerSection[] = [];
    const claimed = new Set<MountedLedgerSection>();

    this.sections = sections;
    // Offsets update BEFORE registers re-window: their getOffsetTop
    // closures must see post-update geometry.
    this.sectionOffsets = this.computeSectionOffsets(sections);

    for (const [index, section] of sections.entries()) {
      const existing = this.mounted.get(section.account);
      const entry =
        existing != null && !claimed.has(existing)
          ? existing
          : this.createMountedSection(section, index);
      claimed.add(entry);
      entry.index = index;
      if (entry === existing) {
        if (!areRegisterRowArraysEqual(entry.rows, section.rows)) {
          entry.register.setRows(section.rows);
        }
        entry.rows = section.rows;
      } else {
        // Duplicate account paths degrade gracefully: the first occurrence
        // keeps the keyed instance, later ones mount fresh (unkeyed).
        content.appendChild(entry.element);
        this.mountSectionElement(entry);
      }
      nextOrder.push(entry);
    }

    // Removed sections: clean up instances and take their elements with
    // them (Registers are container-managed and never remove our nodes).
    for (const entry of previousOrder) {
      if (!claimed.has(entry)) {
        entry.register.cleanUp();
        entry.element.remove();
      }
    }

    // Reorder DOM to match, moving only the nodes that are out of place.
    let previousElement: Element | null = null;
    for (const entry of nextOrder) {
      if (entry.element.previousElementSibling !== previousElement) {
        content.insertBefore(
          entry.element,
          previousElement == null
            ? content.firstChild
            : previousElement.nextSibling
        );
      }
      previousElement = entry.element;
    }

    this.order = nextOrder;
    this.mounted = new Map();
    for (const entry of nextOrder) {
      if (!this.mounted.has(entry.account)) {
        this.mounted.set(entry.account, entry);
      }
    }

    this.restoreScrollAnchor(scroller, anchor);
    virtualizer.instanceChanged();
  }

  getRegisters(): readonly Register[] {
    return this.order.map((entry) => entry.register);
  }

  /**
   * Scrolls the shared container to a section. `align: 'start'` (the
   * default here — jumping to a section means "show me its top") puts the
   * section top at the viewport top, where its own header immediately
   * becomes the stuck header; no extra sticky compensation is needed
   * because the header IS the section's first band. `nearest` reveals the
   * header band with minimal movement. Unknown accounts are a graceful
   * no-op.
   */
  scrollToSection(account: string, options: ScrollToRowOptions = {}): void {
    const entry = this.mounted.get(account);
    const { scroller, smoothScroller } = this;
    if (entry == null || scroller == null || smoothScroller == null) {
      return;
    }
    const { align = 'start', behavior = 'auto' } = options;
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    const top = this.sectionOffsets[entry.index];
    const height = headerHeight + entry.rows.length * this.getRowHeight();
    const viewportHeight = this.getViewportHeight(scroller);
    let target: number;
    if (align === 'start') {
      target = top;
    } else if (align === 'center') {
      target = top + height / 2 - viewportHeight / 2;
    } else if (top < scroller.scrollTop) {
      target = top;
    } else if (top + headerHeight > scroller.scrollTop + viewportHeight) {
      target = top + headerHeight - viewportHeight;
    } else {
      return; // nearest: header band already visible.
    }
    smoothScroller.scrollTo(Math.max(0, target), behavior);
  }

  /**
   * Scrolls to one entry row inside a section — delegates to that
   * Register's scrollToRow, whose position math already folds in the
   * section offset within the SHARED scroller (getOffsetTop) and the sticky
   * header overlay for `start` alignment. Same graceful no-ops (unknown
   * account, out-of-range index).
   */
  scrollToRow(
    account: string,
    entryIndex: number,
    options?: ScrollToRowOptions
  ): void {
    this.mounted.get(account)?.register.scrollToRow(entryIndex, options);
  }

  cleanUp(): void {
    for (const entry of this.order) {
      entry.register.cleanUp();
    }
    this.order = [];
    this.mounted.clear();
    this.smoothScroller?.cleanUp();
    this.smoothScroller = undefined;
    this.virtualizer?.cleanUp();
    this.virtualizer = undefined;
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.scroller = undefined;
    this.content = undefined;
    this.sections = [];
    this.sectionOffsets = [];
  }

  // Wires the scroll container: one shared Virtualizer and one shared
  // SmoothScroller per view, both handed to every section Register so all
  // windowing and all programmatic scrolls flow through single instances.
  private adoptScroller(scroller: HTMLElement, content: HTMLElement): void {
    this.scroller = scroller;
    this.content = content;
    this.virtualizer = new Virtualizer();
    this.virtualizer.setup(scroller, content);
    this.smoothScroller = new SmoothScroller(() => this.scroller, {
      settings: this.options.smoothScrollSettings,
      onScrollFrame: () => this.virtualizer?.instanceChanged(),
    });
  }

  // Builds the live-section record + Register instance for one section.
  // Callbacks close over the RECORD (not the index), so reconciliation can
  // move sections around without re-binding anything.
  private createMountedSection(
    section: LedgerSection,
    index: number
  ): MountedLedgerSection {
    const entry: MountedLedgerSection = {
      account: section.account,
      element: document.createElement('section'),
      rows: section.rows,
      index,
      register: undefined as unknown as Register,
    };
    entry.register = new Register(
      {
        account: section.account,
        density: this.options.density,
        lineHeight: this.options.lineHeight,
        headerHeight: this.options.headerHeight,
        overscanRows: this.options.overscanRows,
        emptyLabel: this.options.emptyLabel,
        amountFormat: this.options.amountFormat,
        id: `${this.viewId}-s${this.nextSectionSerial++}`,
        smoothScroller: this.smoothScroller,
        getOffsetTop: () => this.sectionOffsets[entry.index],
        onRowSelect: (row, rowIndex) => {
          this.handleRowSelect(entry.index, row, rowIndex);
        },
        onFocusBoundary: (direction) => {
          return this.handleFocusBoundary(entry.index, direction);
        },
      },
      // Sections live inside our content element; Register must not remove
      // our nodes on cleanUp.
      true
    );
    return entry;
  }

  // Fresh (non-hydration) mount of one section element into the shared
  // scroller: skeleton + rows through the standard mountSection path.
  private mountSectionElement(entry: MountedLedgerSection): void {
    if (this.virtualizer == null) {
      return;
    }
    entry.register.mountSection(entry.element, this.virtualizer);
    entry.register.setRows(entry.rows);
  }

  /**
   * Captures what the user is looking at before reconciliation: the
   * topmost visible section, the entry row at the viewport top inside it
   * (null while the header band is at the top), and each one's pixel offset
   * from the viewport top. All arithmetic on precomputed offsets — no
   * layout reads.
   */
  private captureScrollAnchor(
    scroller: HTMLElement
  ): LedgerScrollAnchor | null {
    if (this.order.length === 0) {
      return null;
    }
    const scrollTop = scroller.scrollTop;
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    // Topmost visible section: the last one starting at or above scrollTop
    // (linear scan — section counts are small and this runs once per
    // setSections, not per frame).
    let orderIndex = 0;
    for (let index = 1; index < this.order.length; index += 1) {
      if (this.sectionOffsets[index] <= scrollTop) {
        orderIndex = index;
      } else {
        break;
      }
    }
    const entry = this.order[orderIndex];
    const sectionTop = this.sectionOffsets[orderIndex];
    const rowHeight = this.getRowHeight();
    const withinBody = scrollTop - sectionTop - headerHeight;
    let entryIndex: number | null = null;
    let anchorTop = sectionTop;
    if (withinBody >= 0 && entry.rows.length > 0) {
      entryIndex = Math.min(
        entry.rows.length - 1,
        Math.floor(withinBody / rowHeight)
      );
      anchorTop = sectionTop + headerHeight + entryIndex * rowHeight;
    }
    return {
      scrollTop,
      account: entry.account,
      accounts: this.order.map((mountedEntry) => mountedEntry.account),
      orderIndex,
      entryIndex,
      viewportOffset: anchorTop - scrollTop,
      sectionViewportOffset: sectionTop - scrollTop,
    };
  }

  /**
   * Restores the captured anchor against the NEW geometry. Fallback ladder,
   * top rung first:
   * 1. The anchor section survives → its (clamped) anchor row stays at the
   *    same viewport offset, whatever sections above did.
   * 2. Anchor section removed, a PRECEDING old neighbor survives → that
   *    neighbor's bottom takes the removed section's old top position
   *    (content above the removal stays put).
   * 3. Only a FOLLOWING old neighbor survives → its top takes the removed
   *    section's old top position (the view "collapses upward" onto it).
   * 4. Nothing survives → keep the raw scrollTop; the browser clamps it if
   *    the new content is shorter (v1 behavior as the last resort).
   */
  private restoreScrollAnchor(
    scroller: HTMLElement,
    anchor: LedgerScrollAnchor | null
  ): void {
    if (anchor == null || anchor.account == null) {
      return;
    }
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    const rowHeight = this.getRowHeight();
    let target: number | null = null;

    const surviving = this.mounted.get(anchor.account);
    if (surviving != null) {
      let anchorTop = this.sectionOffsets[surviving.index];
      if (anchor.entryIndex != null && surviving.rows.length > 0) {
        const clampedIndex = Math.min(
          anchor.entryIndex,
          surviving.rows.length - 1
        );
        anchorTop += headerHeight + clampedIndex * rowHeight;
      }
      target = anchorTop - anchor.viewportOffset;
    } else {
      for (let distance = 1; distance < anchor.accounts.length; distance += 1) {
        const before = this.mounted.get(
          anchor.accounts[anchor.orderIndex - distance] ?? ''
        );
        if (before != null) {
          const bottom =
            this.sectionOffsets[before.index] +
            headerHeight +
            before.rows.length * rowHeight;
          target = bottom - anchor.sectionViewportOffset;
          break;
        }
        const after = this.mounted.get(
          anchor.accounts[anchor.orderIndex + distance] ?? ''
        );
        if (after != null) {
          target =
            this.sectionOffsets[after.index] - anchor.sectionViewportOffset;
          break;
        }
      }
    }
    target ??= anchor.scrollTop;
    target = Math.max(0, target);
    if (target !== scroller.scrollTop) {
      scroller.scrollTop = target;
    }
  }

  private computeSectionOffsets(sections: readonly LedgerSection[]): number[] {
    const {
      headerHeight = DEFAULT_HEADER_HEIGHT,
      lineHeight = DEFAULT_LINE_HEIGHT,
    } = this.options;
    const rowHeight = this.getRowHeight();
    const offsets: number[] = [];
    let offset = 0;
    for (const section of sections) {
      offsets.push(offset);
      // Zero-row sections render the fixed-height empty-state block instead
      // of rows; it is real flow content, so the estimate must count it or
      // every offset below an empty section drifts by its height. Must
      // agree with Register.getEstimatedHeight (density never scales it).
      offset +=
        headerHeight +
        (section.rows.length === 0
          ? lineHeight + REGISTER_EMPTY_EXTRA_HEIGHT
          : section.rows.length * rowHeight);
    }
    return offsets;
  }

  // Entry row height shared with every section Register (density-scaled);
  // must agree with Register.getRowHeight or offset estimates drift.
  private getRowHeight(): number {
    const { density = 'comfortable', lineHeight = DEFAULT_LINE_HEIGHT } =
      this.options;
    return density === 'compact' ? lineHeight : lineHeight * 2;
  }

  // Viewport height for alignment math; jsdom and pre-layout mounts report
  // 0, which falls back to a plausible default (the Register convention).
  private getViewportHeight(scroller: HTMLElement): number {
    const height = scroller.getBoundingClientRect().height;
    return height > 0 ? height : DEFAULT_VIEWPORT_HEIGHT;
  }

  /**
   * Cross-section keyboard focus handoff. Design: every section stays its
   * own ARIA grid (own tabindex, own aria-activedescendant), and the ledger
   * view only coordinates the seam — ArrowDown past a section's last entry
   * row lands on the next non-empty section's first row, ArrowUp on the
   * previous one's last. `focusRow` both reveals the row and moves DOM focus
   * onto the target section, so subsequent keystrokes are handled there; the
   * source register clears its own focused row after we return true.
   */
  private handleFocusBoundary(
    sectionIndex: number,
    direction: 1 | -1
  ): boolean {
    for (
      let index = sectionIndex + direction;
      index >= 0 && index < this.order.length;
      index += direction
    ) {
      const rowCount = this.order[index].rows.length;
      if (rowCount === 0) {
        continue; // Empty sections have no focusable rows: skip past them.
      }
      this.order[index].register.focusRow(direction === 1 ? 0 : rowCount - 1);
      return true;
    }
    return false;
  }

  // Selecting a row in one section clears selection in every other section:
  // the ledger view models a single focused row across the whole document.
  private handleRowSelect(
    sectionIndex: number,
    row: RegisterRowData,
    rowIndex: number
  ): void {
    for (const [index, entry] of this.order.entries()) {
      if (index !== sectionIndex) {
        entry.register.setSelectedRow(null);
      }
    }
    const section = this.sections[sectionIndex];
    if (section != null) {
      this.options.onRowSelect?.(section.account, row, rowIndex);
    }
  }
}
