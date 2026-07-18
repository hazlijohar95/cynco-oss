import {
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_OVERSCAN_ROWS,
  JOURNALS_TAG_NAME,
} from '../constants';
import { InteractionManager } from '../managers/InteractionManager';
import { queueRender } from '../managers/UniversalRenderingManager';
import {
  type RegisterRenderOptions,
  renderRegisterHeaderHTML,
  renderRegisterRowsHTML,
} from '../renderers/RegisterRenderer';
import type {
  ColorScheme,
  RegisterRowData,
  RowRange,
  VirtualWindowSpecs,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { computeRowWindow } from '../utils/computeRowWindow';
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
  /** Fired when a row is clicked, after the selection attribute is applied. */
  onRowSelect?(row: RegisterRowData, index: number): void;
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

// Virtualized single-account register (bank-statement style). Fixed row
// heights make the window math pure arithmetic: rendered range and spacer
// heights derive from the Virtualizer's pixel window with no per-row
// measurement, so 100k-row registers render the same handful of nodes as
// 100-row ones.
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
  private selectedIndex: number | null = null;
  private renderedRange: RowRange | undefined;
  private visible = false;

  /** Unique per instance, prefixes worker cache keys so instances never collide. */
  private readonly workerInstanceId: string = `register-${++registerInstanceCount}`;
  /** Bumped per setRows so stale row data can never satisfy a cache key. */
  private rowsVersion = 0;
  /** Stamp for in-flight worker windows; only the latest response applies. */
  private windowRenderVersion = 0;

  private virtualizer: Virtualizer | undefined;
  private ownsVirtualizer = false;
  private disconnectVirtualizer: (() => void) | undefined;
  private interactionManager: InteractionManager;

  constructor(
    public options: RegisterOptions,
    private isContainerManaged = false
  ) {
    this.interactionManager = new InteractionManager({
      onRowSelect: this.handleRowSelect,
    });
  }

  setOptions(options: RegisterOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
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

  setRows(rows: readonly RegisterRowData[]): void {
    this.rows = rows;
    this.rowsVersion += 1;
    this.renderedRange = undefined;
    if (this.headerElement != null && this.section != null) {
      const template = document.createElement('div');
      template.innerHTML = renderRegisterHeaderHTML(
        this.options.account,
        rows.length > 0 ? rows[rows.length - 1].runningBalance : null
      );
      const nextHeader = template.firstElementChild;
      if (nextHeader instanceof HTMLElement) {
        this.headerElement.replaceWith(nextHeader);
        this.headerElement = nextHeader;
      }
    }
    this.applyWindow(this.getRowWindow(this.virtualizer?.getWindowSpecs()));
    this.virtualizer?.instanceChanged();
  }

  // Applies/clears the selection attribute in the live DOM and remembers the
  // index so windowed re-renders reproduce it.
  setSelectedRow(index: number | null): void {
    if (this.selectedIndex === index) {
      return;
    }
    const previous = this.selectedIndex;
    this.selectedIndex = index;
    if (previous != null) {
      this.getRowElement(previous)?.removeAttribute('data-row-selected');
    }
    if (index != null) {
      this.getRowElement(index)?.setAttribute('data-row-selected', 'true');
    }
  }

  getSelectedRow(): number | null {
    return this.selectedIndex;
  }

  /** `[start, end)` row range currently in the DOM (exposed for tests). */
  getRenderedRange(): RowRange | undefined {
    return this.renderedRange;
  }

  // VirtualizedInstance: translate the pixel window into a row range and
  // commit it when it changed. Range identity fully determines the DOM (the
  // window is re-derived from data every time), so an unchanged range is
  // always a no-op — even under force — which lets the Virtualizer's
  // corrected geometry pass converge instead of looping.
  onRender(windowSpecs: VirtualWindowSpecs, _force: boolean): boolean {
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

  getEstimatedHeight(): number {
    const { headerHeight = DEFAULT_HEADER_HEIGHT } = this.options;
    return headerHeight + this.rows.length * this.getRowHeight();
  }

  cleanUp(): void {
    this.disconnectVirtualizer?.();
    this.disconnectVirtualizer = undefined;
    if (this.ownsVirtualizer) {
      this.virtualizer?.cleanUp();
    }
    this.virtualizer = undefined;
    this.ownsVirtualizer = false;
    this.interactionManager.cleanUp();
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
    this.renderedRange = undefined;
    this.selectedIndex = null;
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

  // Builds the section skeleton: sticky header, then a body holding the
  // before-spacer, the windowed rows container, and the after-spacer.
  private populateSectionElement(section: HTMLElement): void {
    const { account, density = 'comfortable' } = this.options;
    section.setAttribute('data-register', '');
    section.setAttribute('data-density', density);
    section.innerHTML =
      renderRegisterHeaderHTML(account, null) +
      '<div data-register-body>' +
      '<div data-register-spacer="before" style="height: 0px"></div>' +
      '<div data-register-rows></div>' +
      '<div data-register-spacer="after" style="height: 0px"></div>' +
      '</div>';
  }

  // Takes ownership of an existing section skeleton (fresh, SSR'd, or
  // provided by LedgerView) and wires interaction delegation onto it.
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
    this.interactionManager.setup(section);
  }

  private getRowWindow(windowSpecs: VirtualWindowSpecs | undefined): RowRange {
    const {
      headerHeight = DEFAULT_HEADER_HEIGHT,
      overscanRows = DEFAULT_OVERSCAN_ROWS,
      getOffsetTop,
    } = this.options;
    return computeRowWindow({
      windowSpecs: windowSpecs ?? { top: 0, bottom: 0 },
      bodyTop: (getOffsetTop?.() ?? 0) + headerHeight,
      rowHeight: this.getRowHeight(),
      rowCount: this.rows.length,
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
    const rowHeight = this.getRowHeight();
    spacerBefore.style.setProperty('height', `${range.start * rowHeight}px`);
    spacerAfter.style.setProperty(
      'height',
      `${(this.rows.length - range.end) * rowHeight}px`
    );
    this.renderedRange = range;

    const pool = this.options.workerPool;
    if (pool == null || !pool.isWorkingPool()) {
      rowsElement.innerHTML = renderRegisterRowsHTML(
        this.rows,
        range,
        this.selectedIndex
      );
      return;
    }

    // Worker path: spacers above are already committed (so scrollHeight and
    // scroll position hold steady), the row HTML resolves off-thread and is
    // applied on the next animation frame. A version stamp drops responses
    // for windows the user has already scrolled past.
    const version = ++this.windowRenderVersion;
    const { rows, selectedIndex } = this;
    void pool
      .renderRegisterWindow({
        rows,
        range,
        selectedIndex,
        cacheKey: `${this.workerInstanceId}:${this.rowsVersion}:${range.start}:${range.end}:${selectedIndex ?? 'none'}`,
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
        });
      })
      .catch(() => {
        // Pool terminated (or rejected) mid-flight: fall back to the sync
        // renderer if this window is still the one we want.
        if (version !== this.windowRenderVersion || this.rowsElement == null) {
          return;
        }
        this.rowsElement.innerHTML = renderRegisterRowsHTML(
          this.rows,
          range,
          this.selectedIndex
        );
      });
  }

  private getRowElement(index: number): HTMLElement | undefined {
    const row = this.section?.querySelector(`[data-row-index="${index}"]`);
    return row instanceof HTMLElement ? row : undefined;
  }

  private handleRowSelect = (index: number): void => {
    const row = this.rows[index];
    if (row == null) {
      return;
    }
    this.setSelectedRow(index);
    this.options.onRowSelect?.(row, index);
  };
}
