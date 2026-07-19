// Public facade: mounts the account tree into an <accounts-container>
// shadow root and drives it. Rendering is the journals pattern — pure HTML
// string windows committed with single innerHTML writes, plus targeted
// attribute patching for selection/focus-only changes — no framework
// anywhere. Fixed row heights make all window math pure arithmetic.

import { AccountsContainerLoaded } from '../components/web-components';
import {
  ACCOUNTS_TAG_NAME,
  DEFAULT_CURRENCY,
  DEFAULT_OVERSCAN_ROWS,
  DEFAULT_VIEWPORT_HEIGHT,
  DRAG_EXPAND_DELAY_MS,
  STICKY_ANCESTOR_STACK_MAX,
} from '../constants';
import { AccountTreeController } from '../model/AccountTreeController';
import type {
  AccountMoveListener,
  AccountRenameListener,
  AccountStatusEntry,
  AccountTreeChange,
  AccountTreeContextMenuAnchor,
  AccountTreeContextMenuCloseOptions,
  AccountTreeContextMenuOptions,
  AccountTreeContextMenuSource,
  AccountTreeControllerOptions,
  AccountTreeNameTruncation,
  AccountTreeStickyAncestors,
  ColorScheme,
  LedgerEntry,
  RowRange,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { isComposingEvent } from '../utils/isComposingEvent';
import {
  type AccountTreeRenderOptions,
  renderAccountRowsHTML,
  renderAccountTreeShellHTML,
  renderStickyRowHTML,
} from './AccountTreeRenderer';
import { computeMiddleTruncation } from './computeMiddleTruncation';

/** Callback fired after every selection change. */
export type AccountTreeSelectCallback = (
  selectedPaths: readonly string[],
  focusedPath: string | null
) => void;

export interface AccountTreeOptions extends AccountTreeControllerOptions {
  /**
   * Stable instance id baked into row `id` attributes (and thus
   * aria-activedescendant). Pass the same id to `preloadAccountTreeHTML` so
   * SSR output and the hydrated client agree. Auto-generated when omitted.
   */
  id?: string;
  /** Accessible name for the tree. Default `Accounts`. */
  ariaLabel?: string;
  /**
   * Pins how `light-dark()` colors resolve. The stylesheet declares
   * `:host { color-scheme: light dark }`, which resolves from the USER's OS
   * preference — not the page's chosen theme — so sites with their own
   * light/dark toggle render the wrong mode unless they pin this. `light` /
   * `dark` apply an inline `color-scheme` on the host element (outer tree,
   * so it wins over `:host`); `system` (default) removes the pin and defers
   * to page CSS (e.g. `.dark accounts-container { color-scheme: dark }`) or
   * the OS preference.
   */
  colorScheme?: ColorScheme;
  /** Extra rows rendered above and below the pixel window. Default 10. */
  overscanRows?: number;
  /**
   * Raw CSS appended into the shadow root's `unsafe` layer. Escape hatch —
   * prefer the `--accounts-*` custom property chains first.
   */
  unsafeCSS?: string;
  /** Fired when the selection changes. */
  onSelect?: AccountTreeSelectCallback;
  /** Fired after a committed inline rename (F2 / double-click-on-selected). */
  onRename?: AccountRenameListener;
  /** Fired after a drag & drop re-parenting, with the applied moves. */
  onMove?: AccountMoveListener;
  /**
   * Spring-loaded expansion delay in ms: how long a drag must hover a
   * collapsed group before it auto-expands. Default 700.
   */
  dragExpandDelayMs?: number;
  /**
   * How row names handle horizontal overflow. Default `end` (plain CSS
   * ellipsis, the original behavior). `middle` runs a measured truncation
   * pass after each window commit and on container resize: overflowing
   * names rewrite to `head…tail` keeping the leaf's tail visible, with the
   * full name in `title`. Patched-only commits (selection/focus) skip the
   * pass — their rows' text never changed.
   */
  nameTruncation?: AccountTreeNameTruncation;
  /**
   * Sticky ancestor header shape. Default `nearest` (single mirror row of
   * the nearest off-screen ancestor — the original behavior). `stack`
   * renders the top visible row's whole off-screen visible-ancestor chain
   * (capped at STICKY_ANCESTOR_STACK_MAX, nearest ancestors winning), with
   * clicks on a mirror forwarding to the real ancestor row.
   */
  stickyAncestors?: AccountTreeStickyAncestors;
  /**
   * Context menu composition surface (the Pierre trees contract adapted to
   * string-rendered rows). The component does NOT render a menu — it owns
   * triggering (right-click, Shift+F10 / ContextMenu key, optional per-row
   * "…" button), target normalization, positioning data, ARIA, and the
   * focus lifecycle; the host renders the menu from `onOpen` and MUST call
   * `request.close()` when it dismisses.
   *
   * Focus contract: `close()` (default `restoreFocus: true`) returns focus
   * to the tree and the originating row, re-materializing the row via the
   * scroll-to-path machinery if virtualization evicted it. The
   * rename-handoff: call `close({ restoreFocus: false })` and then
   * `tree.beginRename(request.path)` so the rename input keeps focus
   * without the tree stealing it back.
   *
   * Session contract: exactly one live session at a time. A newer open
   * supersedes the previous one, whose `close()` becomes a no-op — hosts
   * that never observed the supersede can still call it safely.
   */
  contextMenu?: AccountTreeContextMenuOptions;
}

export interface AccountTreeRenderProps {
  /** Existing `<accounts-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

let instanceCounter = 0;

export class AccountTree {
  static LoadedCustomComponent: boolean = AccountsContainerLoaded;

  private readonly controller: AccountTreeController;
  private readonly instanceId: string;

  private container: HTMLElement | undefined;
  private scroller: HTMLElement | undefined;
  private stickyHeader: HTMLElement | undefined;
  private spacerBefore: HTMLElement | undefined;
  private rowsElement: HTMLElement | undefined;
  private spacerAfter: HTMLElement | undefined;

  private renderedRange: RowRange | undefined;
  private unsubscribeController: (() => void) | undefined;
  private unsubscribeRename: (() => void) | undefined;
  private unsubscribeMove: (() => void) | undefined;
  private readonly selectCallbacks = new Set<AccountTreeSelectCallback>();

  /**
   * Double-click disambiguation: rename only starts when the row was ALREADY
   * selected before the click pair began (`detail === 1` snapshot), so the
   * first double-click on a fresh group still just toggles it.
   */
  private lastClickPath: string | null = null;
  private lastClickWasOnSelected = false;

  /** Select-all is a begin-of-session affordance, not a re-attach one. */
  private renameSelectAllPending = false;
  /**
   * Set while applyWindow rewrites rows: destroying a focused input can emit
   * focusout in some engines, which must not be mistaken for a blur-commit.
   */
  private suppressRenameCommit = false;

  /**
   * The live context menu session, or null. Only identity matters: each
   * open creates a fresh token whose `close()` compares against this field,
   * so a superseded session's close is inherently a no-op — the smallest
   * honest state machine for "one menu at a time".
   */
  private contextMenuSession: { readonly path: string } | null = null;

  /**
   * Mirror rows currently rendered in the sticky header. Only meaningful
   * under `stickyAncestors: 'stack'`, where the stack occupies flow space at
   * the top of the content and the before-spacer must shrink by the same
   * pixels to keep absolute row positions at `index * rowHeight`.
   */
  private stickyRowCount = 0;
  /** Re-runs the truncation pass when the scroller resizes ('middle' only). */
  private nameResizeObserver: ResizeObserver | undefined;

  /** Active HTML5 drag session (source paths), or null. */
  private dragPaths: readonly string[] | null = null;
  /** Path of the currently highlighted valid drop target, or null. */
  private dropTargetPath: string | null = null;
  private dragExpandTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    public options: AccountTreeOptions = {},
    private isContainerManaged = false
  ) {
    this.controller = new AccountTreeController(options);
    this.instanceId = options.id ?? `accounts-${(instanceCounter += 1)}`;
  }

  /** The underlying model, for advanced/programmatic use. */
  getController(): AccountTreeController {
    return this.controller;
  }

  /** Replaces view-level options (callbacks, overscan). Data changes go
   * through setEntries / setAccountStatus / setExpanded instead. */
  setOptions(options: AccountTreeOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  // --- Mounting -----------------------------------------------------------------

  /**
   * Renders into a target: pass an `<accounts-container>` to use it
   * directly, any other element to have a container created and appended to
   * it, or a props bag mirroring the journals components.
   */
  render(target?: HTMLElement | AccountTreeRenderProps): void {
    let container: HTMLElement | undefined;
    let parentNode: HTMLElement | undefined;
    if (target instanceof HTMLElement) {
      if (target.tagName.toLowerCase() === ACCOUNTS_TAG_NAME) {
        container = target;
      } else {
        parentNode = target;
      }
    } else if (target != null) {
      container = target.container;
      parentNode = target.parentNode;
    }
    container =
      container ?? this.container ?? document.createElement(ACCOUNTS_TAG_NAME);
    if (parentNode != null && container.parentNode !== parentNode) {
      parentNode.appendChild(container);
    }
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });

    if (this.scroller == null || this.scroller.parentNode !== shadowRoot) {
      // Build the shell empty first, then window rows through the same
      // applyWindow path the scroll handler uses.
      const template = document.createElement('div');
      template.innerHTML = renderAccountTreeShellHTML({
        rowsHTML: '',
        range: { start: 0, end: 0 },
        totalCount: this.controller.getVisibleCount(),
        rowHeight: this.controller.getRowHeight(),
        density: this.controller.getDensity(),
        ariaLabel: this.options.ariaLabel ?? 'Accounts',
      });
      const scroller = template.firstElementChild;
      if (!(scroller instanceof HTMLElement)) {
        return;
      }
      shadowRoot.appendChild(scroller);
      this.adoptShell(scroller);
      this.appendUnsafeCSS(shadowRoot);
    }
    this.startListening();
    this.applyWindow(this.computeRange(), true);
    this.updateStickyHeader();
  }

  /**
   * Adopts SSR output (scroller/rows already inside the declarative shadow
   * root) without touching the pre-rendered nodes: the adopted row window is
   * recorded and only replaced when scrolling (or a data change) demands a
   * different range.
   */
  hydrate(container: HTMLElement): void {
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const scroller = shadowRoot.querySelector('[data-scroller]');
    if (!(scroller instanceof HTMLElement)) {
      this.render({ container });
      return;
    }
    this.container = container;
    this.adoptShell(scroller);
    this.appendUnsafeCSS(shadowRoot);
    // SSR always renders the leading window, so the adopted range starts at
    // row 0 and spans however many rows the server emitted.
    this.renderedRange = {
      start: 0,
      end: this.rowsElement?.children.length ?? 0,
    };
    this.startListening();
  }

  cleanUp(): void {
    this.nameResizeObserver?.disconnect();
    this.nameResizeObserver = undefined;
    this.stickyRowCount = 0;
    this.unsubscribeController?.();
    this.unsubscribeController = undefined;
    this.unsubscribeRename?.();
    this.unsubscribeRename = undefined;
    this.unsubscribeMove?.();
    this.unsubscribeMove = undefined;
    this.clearDragExpandTimer();
    this.dragPaths = null;
    this.dropTargetPath = null;
    this.contextMenuSession = null;
    if (this.scroller != null) {
      this.scroller.removeEventListener('scroll', this.handleScroll);
      this.scroller.removeEventListener('click', this.handleClick);
      this.scroller.removeEventListener('dblclick', this.handleDoubleClick);
      this.scroller.removeEventListener('contextmenu', this.handleContextMenu);
      this.scroller.removeEventListener('keydown', this.handleKeyDown);
      this.scroller.removeEventListener('input', this.handleInput);
      this.scroller.removeEventListener('focusout', this.handleFocusOut);
      this.scroller.removeEventListener('dragstart', this.handleDragStart);
      this.scroller.removeEventListener('dragover', this.handleDragOver);
      this.scroller.removeEventListener('dragleave', this.handleDragLeave);
      this.scroller.removeEventListener('drop', this.handleDrop);
      this.scroller.removeEventListener('dragend', this.handleDragEnd);
    }
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.scroller = undefined;
    this.stickyHeader = undefined;
    this.spacerBefore = undefined;
    this.rowsElement = undefined;
    this.spacerAfter = undefined;
    this.renderedRange = undefined;
  }

  // --- Public model passthroughs ---------------------------------------------------

  getSelectedPaths(): string[] {
    return this.controller.getSelectedPaths();
  }

  getFocusedPath(): string | null {
    return this.controller.getFocusedPath();
  }

  setEntries(entries: readonly LedgerEntry[]): void {
    this.controller.setEntries(entries);
  }

  setAccountStatus(entries: readonly AccountStatusEntry[]): void {
    this.controller.setAccountStatus(entries);
  }

  setExpanded(path: string, expanded: boolean): void {
    this.controller.setExpanded(path, expanded);
  }

  expandAll(): void {
    this.controller.expandAll();
  }

  collapseAll(): void {
    this.controller.collapseAll();
  }

  /** Registers a selection callback; returns an unsubscribe function. */
  onSelect(callback: AccountTreeSelectCallback): () => void {
    this.selectCallbacks.add(callback);
    return () => {
      this.selectCallbacks.delete(callback);
    };
  }

  /** Registers a rename callback; returns an unsubscribe function. */
  onRename(callback: AccountRenameListener): () => void {
    return this.controller.onRename(callback);
  }

  /** Registers a move callback; returns an unsubscribe function. */
  onMove(callback: AccountMoveListener): () => void {
    return this.controller.onMove(callback);
  }

  /**
   * Starts an inline rename for a path (the F2 / double-click-on-selected
   * flow, exposed for programmatic use). Reveals the row first so the input
   * can render.
   */
  beginRename(path: string): void {
    if (!this.controller.hasAccount(path)) {
      return;
    }
    this.controller.revealPath(path);
    this.startRenameSession(path);
  }

  /** Toggles single-child group-chain flattening (see controller docs). */
  setFlattenEmptyGroups(value: boolean): void {
    this.controller.setFlattenEmptyGroups(value);
  }

  /** `[start, end)` row range currently in the DOM (exposed for tests). */
  getRenderedRange(): RowRange | undefined {
    return this.renderedRange;
  }

  /**
   * Scrolls a path into view, expanding collapsed ancestors so its row
   * exists in the projection first. `focus: true` also moves keyboard focus
   * to it.
   */
  scrollToPath(path: string, options: { focus?: boolean } = {}): void {
    if (!this.controller.hasAccount(path)) {
      return;
    }
    this.controller.revealPath(path);
    const index = this.controller.getPathIndex(path);
    if (index < 0) {
      return;
    }
    this.scrollRowIntoView(index);
    if (options.focus === true) {
      this.controller.setFocusedPath(path);
    }
    this.applyWindow(this.computeRange());
    this.updateStickyHeader();
  }

  // --- Internals ----------------------------------------------------------------------

  private adoptShell(scroller: HTMLElement): void {
    this.scroller = scroller;
    this.stickyHeader = queryElement(scroller, '[data-sticky-header]');
    this.spacerBefore = queryElement(scroller, '[data-spacer="before"]');
    this.rowsElement = queryElement(scroller, '[data-rows]');
    this.spacerAfter = queryElement(scroller, '[data-spacer="after"]');
    // The stack variant is click-forwarding, so it opts back into pointer
    // events via CSS keyed on this attribute; 'nearest' stays inert (v1).
    if (this.options.stickyAncestors === 'stack') {
      this.stickyHeader?.setAttribute('data-sticky-stack', 'true');
    }
  }

  private appendUnsafeCSS(shadowRoot: ShadowRoot): void {
    const { unsafeCSS } = this.options;
    if (unsafeCSS == null || unsafeCSS === '') {
      return;
    }
    if (shadowRoot.querySelector('style[data-accounts-unsafe]') != null) {
      return;
    }
    // Wrapped in the `unsafe` layer so the escape hatch always beats the
    // base/theme layers without specificity games.
    const style = document.createElement('style');
    style.setAttribute('data-accounts-unsafe', '');
    style.textContent = `@layer unsafe{${unsafeCSS}}`;
    shadowRoot.appendChild(style);
  }

  private startListening(): void {
    if (this.scroller != null) {
      this.scroller.addEventListener('scroll', this.handleScroll);
      this.scroller.addEventListener('click', this.handleClick);
      this.scroller.addEventListener('dblclick', this.handleDoubleClick);
      this.scroller.addEventListener('contextmenu', this.handleContextMenu);
      this.scroller.addEventListener('keydown', this.handleKeyDown);
      this.scroller.addEventListener('input', this.handleInput);
      this.scroller.addEventListener('focusout', this.handleFocusOut);
      this.scroller.addEventListener('dragstart', this.handleDragStart);
      this.scroller.addEventListener('dragover', this.handleDragOver);
      this.scroller.addEventListener('dragleave', this.handleDragLeave);
      this.scroller.addEventListener('drop', this.handleDrop);
      this.scroller.addEventListener('dragend', this.handleDragEnd);
    }
    this.unsubscribeController ??= this.controller.onChange(
      this.handleControllerChange
    );
    // Model-level rename/move events forward to the view options so React
    // and vanilla callers wire callbacks in one place.
    this.unsubscribeRename ??= this.controller.onRename((oldPath, newPath) => {
      this.options.onRename?.(oldPath, newPath);
    });
    this.unsubscribeMove ??= this.controller.onMove((moves) => {
      this.options.onMove?.(moves);
    });
    // Container resizes change how much text fits, so 'middle' truncation
    // re-measures on them. Degrades gracefully where ResizeObserver is
    // missing (old jsdom): names then only re-truncate on window commits.
    if (
      this.options.nameTruncation === 'middle' &&
      this.nameResizeObserver == null &&
      this.scroller != null &&
      typeof ResizeObserver !== 'undefined'
    ) {
      this.nameResizeObserver = new ResizeObserver(() => {
        this.applyNameTruncation();
      });
      this.nameResizeObserver.observe(this.scroller);
    }
  }

  private getRenderOptions(): AccountTreeRenderOptions {
    return {
      currency: this.options.currency ?? DEFAULT_CURRENCY,
      showBalances: this.options.showBalances,
      idPrefix: this.instanceId,
      renamingPath: this.controller.getRenamingPath(),
      renameDraft: this.controller.getRenameDraft(),
      contextMenu: this.options.contextMenu != null,
      contextMenuRowButton: this.options.contextMenu?.rowButton === true,
    };
  }

  // Viewport height read once per pass; jsdom and pre-layout mounts report 0,
  // which falls back to the default projection height so first paints always
  // render a plausible window.
  private getViewportHeight(): number {
    const height = this.scroller?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : DEFAULT_VIEWPORT_HEIGHT;
  }

  private computeRange(): RowRange {
    const scrollTop = this.scroller?.scrollTop ?? 0;
    return this.controller.getVisibleRange(
      scrollTop,
      this.getViewportHeight(),
      this.options.overscanRows ?? DEFAULT_OVERSCAN_ROWS
    );
  }

  // Commits a row window: one innerHTML write for the rows plus two spacer
  // height writes. The window is bounded (~viewport + 2 * overscan rows), so
  // rebuilding it wholesale stays comfortably within frame budget.
  private applyWindow(range: RowRange, force = false): void {
    const { spacerBefore, rowsElement, spacerAfter } = this;
    if (spacerBefore == null || rowsElement == null || spacerAfter == null) {
      return;
    }
    if (
      !force &&
      this.renderedRange != null &&
      this.renderedRange.start === range.start &&
      this.renderedRange.end === range.end
    ) {
      return;
    }
    const rowHeight = this.controller.getRowHeight();
    const totalCount = this.controller.getVisibleCount();
    this.renderedRange = range;
    this.syncSpacerBefore();
    spacerAfter.style.setProperty(
      'height',
      `${Math.max(0, totalCount - range.end) * rowHeight}px`
    );
    // The rewrite can destroy a focused rename input; that is an eviction,
    // not a blur-commit, so the focusout handler is suppressed for its
    // duration (the input reappears with the draft when the row re-renders).
    this.suppressRenameCommit = true;
    rowsElement.innerHTML = renderAccountRowsHTML(
      this.controller.getRows(range.start, range.end),
      range,
      this.getRenderOptions()
    );
    this.suppressRenameCommit = false;
    this.updateActiveDescendant();
    this.patchDragStates();
    this.restoreRenameFocus();
    // Full rewrites (fresh windows, expansion/status/rename rebuilds) are
    // the only commits whose row text can change, so they are the only
    // commits that re-measure. Patched-only commits (patchRowStates) skip
    // measurement by construction.
    this.applyNameTruncation();
  }

  /**
   * Commits the before-spacer height for the rendered range. Under
   * `stickyAncestors: 'stack'` the sticky mirrors occupy flow space at the
   * top of the content (position: sticky keeps them painted at the viewport
   * top), which would push every row down by the stack height and desync
   * the pixel window math; the spacer shrinks by the same pixels so rows
   * stay at `index * rowHeight`. Near the very top the deficit clamps to 0 —
   * overscan absorbs the residual, exactly how the single-row 'nearest' v1
   * (which deliberately keeps its original uncompensated behavior) absorbs
   * its one-row drift.
   */
  private syncSpacerBefore(): void {
    const { spacerBefore } = this;
    const range = this.renderedRange;
    if (spacerBefore == null || range == null) {
      return;
    }
    const rowHeight = this.controller.getRowHeight();
    const stickyFlowHeight =
      this.options.stickyAncestors === 'stack'
        ? this.stickyRowCount * rowHeight
        : 0;
    spacerBefore.style.setProperty(
      'height',
      `${Math.max(0, range.start * rowHeight - stickyFlowHeight)}px`
    );
  }

  /**
   * Measured middle truncation (`nameTruncation: 'middle'`): one batched
   * pass over the rendered rows' name elements, run after every full window
   * commit and on container resize. The phase split is strict — ALL layout
   * reads (scrollWidth/clientWidth) happen together before ANY text/title
   * write — so the pass forces at most one reflow; each of the ≤2 capped
   * correction iterations repeats the same read-then-write split for rows
   * whose proportional estimate still overflows, bounding the whole pass at
   * three reflows total with no per-character measure loops.
   *
   * Only presentation text is rewritten: row data attributes and controller
   * state keep the FULL name (rename seeds its draft from the controller,
   * so it always edits the real name). `title` is set only on truncated
   * rows — a title on every row would be tooltip noise. Truncated flattened
   * chains temporarily flatten their segment markup into the joined plain
   * label; the next window commit re-renders the styled segments and
   * re-measures. jsdom (both widths 0) measures nothing: graceful no-op.
   */
  private applyNameTruncation(): void {
    const { rowsElement } = this;
    if (this.options.nameTruncation !== 'middle' || rowsElement == null) {
      return;
    }

    interface Candidate {
      nameElement: HTMLElement;
      fullText: string;
      fullWidth: number;
      availableWidth: number;
    }

    // Read phase: every geometry read for the whole window, batched. A
    // previously truncated element's scrollWidth describes the truncated
    // text, so its full-text width is remembered in data-full-width from
    // the pass that first measured it untruncated.
    const candidates: Candidate[] = [];
    for (const element of rowsElement.children) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const nameElement = element.querySelector('[data-name]');
      if (!(nameElement instanceof HTMLElement)) {
        continue; // Renaming rows swap the label for an input: nothing to measure.
      }
      const path = this.getRowPath(element);
      const row = path != null ? this.controller.getRow(path) : null;
      if (row == null) {
        continue;
      }
      const fullText = row.flattenedNames?.join(' : ') ?? row.name;
      const rememberedWidth = Number(nameElement.dataset.fullWidth);
      const fullWidth =
        nameElement.dataset.truncated === 'true' &&
        Number.isFinite(rememberedWidth)
          ? rememberedWidth
          : nameElement.scrollWidth;
      candidates.push({
        nameElement,
        fullText,
        fullWidth,
        availableWidth: nameElement.clientWidth,
      });
    }

    // Write phase: rewrite only overflowing names; restore names that fit
    // again (resize grew the container); leave everything else untouched.
    const written: Candidate[] = [];
    for (const candidate of candidates) {
      const { nameElement, fullText, fullWidth, availableWidth } = candidate;
      const truncated = computeMiddleTruncation(
        fullText,
        fullWidth,
        availableWidth
      );
      if (truncated == null) {
        if (nameElement.dataset.truncated === 'true') {
          nameElement.textContent = fullText;
          nameElement.removeAttribute('title');
          delete nameElement.dataset.truncated;
        }
        continue;
      }
      if (nameElement.dataset.truncated !== 'true') {
        nameElement.dataset.fullWidth = String(fullWidth);
      }
      nameElement.dataset.truncated = 'true';
      nameElement.textContent = truncated;
      nameElement.title = fullText;
      written.push(candidate);
    }

    // Correction iterations: the proportional estimate can undershoot on
    // uneven glyph widths. Re-measure ONLY the rewritten elements (again
    // reads-then-writes) and shave the budget from the observed overflow
    // ratio. Two iterations converge in practice; a stubborn row after that
    // clips under the CSS ellipsis rather than looping.
    let pending = written;
    for (
      let iteration = 0;
      iteration < 2 && pending.length > 0;
      iteration += 1
    ) {
      const overflowing: (Candidate & { estimatedFullWidth: number })[] = [];
      for (const candidate of pending) {
        const { nameElement, fullText } = candidate;
        const scrollWidth = nameElement.scrollWidth;
        const clientWidth = nameElement.clientWidth;
        const currentLength = nameElement.textContent?.length ?? 0;
        if (scrollWidth <= clientWidth || currentLength <= 2) {
          continue;
        }
        overflowing.push({
          ...candidate,
          availableWidth: clientWidth,
          // Average char width of the CURRENT text projects a fresh (and
          // strictly smaller) budget for the full string.
          estimatedFullWidth: (scrollWidth / currentLength) * fullText.length,
        });
      }
      for (const candidate of overflowing) {
        const truncated = computeMiddleTruncation(
          candidate.fullText,
          candidate.estimatedFullWidth,
          candidate.availableWidth
        );
        if (truncated != null) {
          candidate.nameElement.textContent = truncated;
        }
      }
      pending = overflowing;
    }
  }

  /**
   * Selection/focus-only changes patch attributes on the rows already in the
   * DOM instead of rebuilding the window — the targeted-patching half of the
   * rendering contract.
   */
  private patchRowStates(): void {
    const { rowsElement } = this;
    if (rowsElement == null) {
      return;
    }
    const visible = this.controller.getVisiblePaths();
    const focusedPath = this.controller.getFocusedPath();
    for (const element of rowsElement.children) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const raw = element.getAttribute('data-row-index');
      if (raw == null) {
        continue;
      }
      const index = Number(raw);
      const path = visible[index];
      if (path == null) {
        continue;
      }
      const selected = this.controller.isSelected(path);
      const focused = focusedPath === path;
      element.setAttribute('aria-selected', String(selected));
      if (selected) {
        element.setAttribute('data-selected', 'true');
      } else {
        element.removeAttribute('data-selected');
      }
      if (focused) {
        element.setAttribute('data-focused', 'true');
      } else {
        element.removeAttribute('data-focused');
      }
      element.setAttribute('tabindex', focused ? '0' : '-1');
    }
    this.updateActiveDescendant();
  }

  private updateActiveDescendant(): void {
    const { scroller } = this;
    if (scroller == null) {
      return;
    }
    const focusedPath = this.controller.getFocusedPath();
    const index =
      focusedPath != null ? this.controller.getPathIndex(focusedPath) : -1;
    const range = this.renderedRange;
    if (
      index >= 0 &&
      range != null &&
      index >= range.start &&
      index < range.end
    ) {
      scroller.setAttribute(
        'aria-activedescendant',
        `${this.instanceId}-row-${index}`
      );
    } else {
      scroller.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Sticky ancestor header. In DFS order every proper ancestor precedes its
   * descendants, so the top visible row's ancestors are always scrolled off
   * — mirror them, aria-hidden. `nearest` (default) keeps the v1 behavior:
   * one row for the nearest visible ancestor. `stack` mirrors the whole
   * visible-ancestor chain (so flattening and hide-non-matches never
   * surface hidden mid-chain groups), capped at STICKY_ANCESTOR_STACK_MAX
   * with the nearest ancestors winning, and compensates the before-spacer
   * for the stack's flow height (see syncSpacerBefore).
   */
  private updateStickyHeader(): void {
    const { stickyHeader, scroller } = this;
    if (stickyHeader == null || scroller == null) {
      return;
    }
    const stackMode = this.options.stickyAncestors === 'stack';
    const rowHeight = this.controller.getRowHeight();
    const count = this.controller.getVisibleCount();
    const topIndex = Math.floor(scroller.scrollTop / rowHeight);

    let ancestorPaths: string[] = [];
    if (topIndex > 0 && count > 0) {
      const visible = this.controller.getVisiblePaths();
      const topPath = visible[Math.min(topIndex, count - 1)];
      // Ancestors that own visible rows: under flattening (and the
      // hide-non-matches filter) a plain parent walk could land on a
      // mid-chain group with no row to mirror or forward to.
      if (stackMode) {
        ancestorPaths = this.controller
          .getVisibleAncestorPaths(topPath)
          .slice(-STICKY_ANCESTOR_STACK_MAX);
      } else {
        const nearest = this.controller.getVisibleParentPath(topPath);
        ancestorPaths = nearest != null ? [nearest] : [];
      }
    }

    let html = '';
    for (const path of ancestorPaths) {
      const row = this.controller.getRow(path);
      if (row != null) {
        html += renderStickyRowHTML(row, this.getRenderOptions());
      }
    }
    if (html === '') {
      stickyHeader.hidden = true;
      if (this.stickyRowCount !== 0) {
        this.stickyRowCount = 0;
        this.syncSpacerBefore();
      }
      return;
    }
    stickyHeader.innerHTML = html;
    stickyHeader.hidden = false;
    if (this.stickyRowCount !== ancestorPaths.length) {
      this.stickyRowCount = ancestorPaths.length;
      this.syncSpacerBefore();
    }
  }

  // Adjusts scrollTop so the row at `index` is fully inside the viewport
  // (minimal movement, like Element.scrollIntoView({ block: 'nearest' })).
  // Under `stickyAncestors: 'stack'` the effective viewport top sits below
  // the sticky overlay, so upward scrolls land the target under a stack the
  // size of its own visible-ancestor chain instead of hidden beneath it.
  // (The landed stack is recomputed from the new top row, so the estimate
  // can be off by a row in reshuffled subtrees — a cosmetic, self-correcting
  // drift, never a lost row.)
  private scrollRowIntoView(index: number): void {
    const { scroller } = this;
    if (scroller == null || index < 0) {
      return;
    }
    const rowHeight = this.controller.getRowHeight();
    const viewportHeight = this.getViewportHeight();
    const rowTop = index * rowHeight;
    let coveredHeight = 0;
    if (this.options.stickyAncestors === 'stack') {
      const path = this.controller.getVisiblePaths()[index];
      if (path != null) {
        coveredHeight =
          Math.min(
            STICKY_ANCESTOR_STACK_MAX,
            this.controller.getVisibleAncestorPaths(path).length
          ) * rowHeight;
      }
    }
    if (rowTop < scroller.scrollTop + coveredHeight) {
      scroller.scrollTop = Math.max(0, rowTop - coveredHeight);
    } else if (rowTop + rowHeight > scroller.scrollTop + viewportHeight) {
      scroller.scrollTop = rowTop + rowHeight - viewportHeight;
    }
  }

  // Scroll hysteresis (the Pierre computeWindowRange rule): while the raw
  // visible range (no overscan) still fits inside the rendered window, keep
  // it — the overscan buffer exists precisely so small scrolls are free.
  // Only when the viewport escapes the buffer is a new overscanned window
  // committed.
  private handleScroll = (): void => {
    const rendered = this.renderedRange;
    if (rendered != null && this.scroller != null) {
      const visible = this.controller.getVisibleRange(
        this.scroller.scrollTop,
        this.getViewportHeight(),
        0
      );
      if (visible.start >= rendered.start && visible.end <= rendered.end) {
        this.updateStickyHeader();
        return;
      }
    }
    this.applyWindow(this.computeRange());
    this.updateStickyHeader();
  };

  private handleControllerChange = (change: AccountTreeChange): void => {
    if (
      change.expansionChanged ||
      change.statusChanged ||
      change.renameChanged
    ) {
      this.applyWindow(this.computeRange(), true);
      this.updateStickyHeader();
    } else if (change.selectionChanged || change.focusChanged) {
      this.patchRowStates();
    }
    if (change.selectionChanged) {
      const selected = this.controller.getSelectedPaths();
      const focused = this.controller.getFocusedPath();
      this.options.onSelect?.(selected, focused);
      for (const callback of this.selectCallbacks) {
        callback(selected, focused);
      }
    }
  };

  private handleClick = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-rename-input]') != null
    ) {
      return; // Clicks inside the rename editor never drive tree behavior.
    }
    const row = getRowFromEvent(event);
    if (row == null) {
      return;
    }
    if (row.getAttribute('data-sticky-row') === 'true') {
      this.forwardStickyRowClick(row);
      return;
    }
    const path = this.getRowPath(row);
    if (path == null) {
      return;
    }
    // Row-actions button lane: the click opens the menu (anchored to the
    // button's rect) instead of driving selection — target normalization
    // inside openContextMenu still selects the row when needed.
    const actionButton =
      target instanceof Element ? target.closest('[data-row-action]') : null;
    if (actionButton instanceof HTMLElement) {
      event.preventDefault();
      this.openContextMenu(
        path,
        { rect: actionButton.getBoundingClientRect() },
        'button'
      );
      return;
    }
    const mouse = event as MouseEvent;
    // Snapshot the pre-click selection state on the FIRST click of a pair so
    // double-click can distinguish "was already selected" (rename) from
    // "selected by this very click pair" (group toggle).
    if (mouse.detail <= 1) {
      this.lastClickPath = path;
      this.lastClickWasOnSelected = this.controller.isSelected(path);
    }
    const onChevron =
      target instanceof Element && target.closest('[data-chevron]') != null;
    if (onChevron && row.getAttribute('data-kind') === 'group') {
      // Chevron clicks toggle without disturbing the selection.
      this.controller.setExpanded(path, !this.controller.isExpanded(path));
      return;
    }
    this.controller.selectPath(path, {
      additive: mouse.metaKey || mouse.ctrlKey,
      range: mouse.shiftKey,
    });
  };

  /**
   * Sticky-stack click forwarding (Pierre's overlay idiom): a click on a
   * mirror scrolls to and focuses the REAL ancestor row — the mirror itself
   * is aria-hidden and must never act as a treeitem. Only the 'stack' mode
   * receives these clicks; 'nearest' keeps its v1 `pointer-events: none`
   * surface, so this handler is unreachable there (guarded anyway for
   * synthetic events).
   */
  private forwardStickyRowClick(row: HTMLElement): void {
    if (this.options.stickyAncestors !== 'stack') {
      return;
    }
    const path = row.getAttribute('data-path');
    if (path == null || !this.controller.hasAccount(path)) {
      return;
    }
    this.scrollToPath(path, { focus: true });
    // Move DOM focus onto the real row so keyboard interaction continues
    // from the ancestor, mirroring the context-menu focus-restore path.
    this.getRenderedRowElement(this.controller.getPathIndex(path))?.focus();
  }

  private handleDoubleClick = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest('[data-rename-input]') != null ||
        // Rapid clicks on the row-actions button belong to the menu, never
        // to rename/group-toggle disambiguation.
        target.closest('[data-row-action]') != null)
    ) {
      return;
    }
    const row = getRowFromEvent(event);
    if (row == null || row.getAttribute('data-sticky-row') === 'true') {
      return;
    }
    const path = this.getRowPath(row);
    if (path == null) {
      return;
    }
    // Double-click on an already-selected row starts a rename (Pierre's
    // slow-rename analog); otherwise groups keep their toggle behavior.
    if (this.lastClickPath === path && this.lastClickWasOnSelected) {
      this.startRenameSession(path);
      return;
    }
    if (row.getAttribute('data-kind') !== 'group') {
      return;
    }
    this.controller.setExpanded(path, !this.controller.isExpanded(path));
  };

  private handleKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    // IME guard, first thing: keys consumed by an active composition must
    // never navigate, type-ahead, commit a rename (Enter confirms the IME
    // candidate) or cancel one (Escape dismisses the candidate).
    if (isComposingEvent(keyboard)) {
      return;
    }
    const { key } = keyboard;
    const controller = this.controller;
    const focused = controller.getFocusedPath();

    // Keys typed inside the rename editor belong to it: Enter commits,
    // Escape cancels, everything else is plain text editing — tree
    // navigation must not hijack arrows or type-ahead while renaming.
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-rename-input]') != null
    ) {
      if (key === 'Enter') {
        keyboard.preventDefault();
        this.commitRenameFromView();
      } else if (key === 'Escape') {
        keyboard.preventDefault();
        this.controller.cancelRename();
      }
      return;
    }

    // Keyboard menu opens target the focused row with its rect as anchor.
    // preventDefault also suppresses the native contextmenu event browsers
    // synthesize for the ContextMenu key / Shift+F10, so the keyboard open
    // is not immediately superseded by a pointer-sourced one at (0,0).
    if (
      this.options.contextMenu != null &&
      ((keyboard.shiftKey && key === 'F10') || key === 'ContextMenu')
    ) {
      if (focused != null) {
        keyboard.preventDefault();
        this.openContextMenuForFocusedRow(focused);
      }
      return;
    }

    if (key === 'F2') {
      if (focused != null) {
        keyboard.preventDefault();
        this.startRenameSession(focused);
      }
      return;
    }

    let handled = true;
    switch (key) {
      case 'ArrowDown':
        controller.moveFocus(1);
        break;
      case 'ArrowUp':
        controller.moveFocus(-1);
        break;
      case 'ArrowRight': {
        if (focused == null) {
          controller.moveFocus(1);
        } else if (
          controller.getRow(focused)?.kind === 'group' &&
          !controller.isExpanded(focused)
        ) {
          controller.setExpanded(focused, true);
        } else if (controller.isExpanded(focused)) {
          // Expanded group: first child is the next visible row in DFS order.
          controller.moveFocus(1);
        }
        break;
      }
      case 'ArrowLeft': {
        if (focused == null) {
          break;
        }
        if (controller.isExpanded(focused)) {
          controller.setExpanded(focused, false);
        } else {
          // Nearest visible ancestor: under flattening the canonical parent
          // can be a hidden mid-chain group with no row to focus.
          const parent = controller.getVisibleParentPath(focused);
          if (parent != null) {
            controller.setFocusedPath(parent);
          }
        }
        break;
      }
      case 'Enter': {
        if (focused != null) {
          controller.selectPath(focused);
        }
        break;
      }
      case 'Home':
        controller.focusIndex(0);
        break;
      case 'End':
        controller.focusIndex(controller.getVisibleCount() - 1);
        break;
      case 'F3': {
        // F3 / Shift+F3 step through search matches while a session is
        // active (the browser's own find dialog is only shadowed then).
        // Hosts building a search input should call the controller's
        // focusNextSearchMatch / focusPreviousSearchMatch directly — this
        // binding only serves keyboard users focused on the tree itself.
        if (controller.isSearchActive()) {
          if (keyboard.shiftKey) {
            controller.focusPreviousSearchMatch();
          } else {
            controller.focusNextSearchMatch();
          }
        } else {
          handled = false;
        }
        break;
      }
      default: {
        // Type-ahead: a single printable character with no modifiers.
        if (
          key.length === 1 &&
          key !== ' ' &&
          !keyboard.metaKey &&
          !keyboard.ctrlKey &&
          !keyboard.altKey
        ) {
          controller.focusByTypeAhead(key);
        } else {
          handled = false;
        }
      }
    }
    if (handled) {
      keyboard.preventDefault();
      const nextFocused = controller.getFocusedPath();
      if (nextFocused != null) {
        this.scrollRowIntoView(controller.getPathIndex(nextFocused));
        this.applyWindow(this.computeRange());
        this.updateStickyHeader();
      }
    }
  };

  // --- Context menu composition ----------------------------------------------------------

  // Right-click on a row: prevent the native menu, then run the standard
  // tree UX — focus + select the target first when it is not already part of
  // the selection — and emit the request anchored at the pointer.
  private handleContextMenu = (event: Event): void => {
    if (this.options.contextMenu == null) {
      return;
    }
    const row = getRowFromEvent(event);
    if (row == null || row.getAttribute('data-sticky-row') === 'true') {
      return;
    }
    const path = this.getRowPath(row);
    if (path == null) {
      return;
    }
    event.preventDefault();
    const mouse = event as MouseEvent;
    this.openContextMenu(
      path,
      { x: mouse.clientX, y: mouse.clientY },
      'pointer'
    );
  };

  // Shift+F10 / ContextMenu key: anchor at the focused row's rect. The row
  // is materialized first (focused rows can sit just outside the rendered
  // window after programmatic focus) so a real rect exists to measure.
  private openContextMenuForFocusedRow(path: string): void {
    const index = this.controller.getPathIndex(path);
    if (index < 0) {
      return;
    }
    this.scrollRowIntoView(index);
    this.applyWindow(this.computeRange());
    const row = this.getRenderedRowElement(index);
    const anchor: AccountTreeContextMenuAnchor =
      row != null
        ? { rect: row.getBoundingClientRect() }
        : // Degrade gracefully: no rect measurable (should not happen once
          // the window is applied) still opens the menu at the origin.
          { x: 0, y: 0 };
    this.openContextMenu(path, anchor, 'keyboard');
  }

  /**
   * Starts a context menu session. Target normalization mirrors drag & drop:
   * a row inside the current multi-selection targets the whole selection; a
   * row outside it becomes the selection (and focus) first, so `paths` is
   * always the live selection. Opening supersedes any previous session —
   * its `close()` turns into a no-op via the token comparison below.
   */
  private openContextMenu(
    path: string,
    anchor: AccountTreeContextMenuAnchor,
    source: AccountTreeContextMenuSource
  ): void {
    const contextMenu = this.options.contextMenu;
    if (contextMenu == null || !this.controller.hasAccount(path)) {
      return;
    }
    if (!this.controller.isSelected(path)) {
      this.controller.selectPath(path);
    } else if (this.controller.getFocusedPath() !== path) {
      this.controller.setFocusedPath(path);
    }
    const session = { path };
    this.contextMenuSession = session;
    contextMenu.onOpen({
      path,
      paths: this.controller.getSelectedPaths(),
      anchor,
      source,
      close: (options?: AccountTreeContextMenuCloseOptions) =>
        this.closeContextMenuSession(session, options),
    });
  }

  // `close()` half of the composition contract. Stale (superseded) sessions
  // are ignored so a host closing late never steals focus from the newer
  // menu. `restoreFocus: false` is the rename-handoff escape hatch: the
  // session just ends and the host owns focus (e.g. beginRename next).
  private closeContextMenuSession(
    session: { readonly path: string },
    options?: AccountTreeContextMenuCloseOptions
  ): void {
    if (this.contextMenuSession !== session) {
      return;
    }
    this.contextMenuSession = null;
    if (options?.restoreFocus === false) {
      return;
    }
    this.restoreFocusAfterContextMenu(session.path);
  }

  // Returns focus to the tree and the originating row, re-materializing the
  // row through the existing reveal/scroll machinery when virtualization
  // evicted it. A vanished path (renamed/moved by a menu action that kept
  // restoreFocus on) degrades to focusing the tree surface itself.
  private restoreFocusAfterContextMenu(path: string): void {
    if (this.controller.hasAccount(path)) {
      this.scrollToPath(path, { focus: true });
      const index = this.controller.getPathIndex(path);
      const row = this.getRenderedRowElement(index);
      if (row != null) {
        row.focus();
        return;
      }
    }
    this.scroller?.focus();
  }

  /** Flow row element for a visible index, when inside the rendered window. */
  private getRenderedRowElement(index: number): HTMLElement | null {
    if (index < 0) {
      return null;
    }
    const row = this.rowsElement?.querySelector(`[data-row-index="${index}"]`);
    return row instanceof HTMLElement ? row : null;
  }

  // --- Rename session (view side) --------------------------------------------------------

  // Begins the controller session and schedules the one-time select-all: the
  // renameChanged event rebuilds the window, which renders the input, and
  // restoreRenameFocus focuses + selects it.
  private startRenameSession(path: string): void {
    this.renameSelectAllPending = true;
    if (!this.controller.beginRename(path)) {
      this.renameSelectAllPending = false;
    }
  }

  private commitRenameFromView(): void {
    const path = this.controller.getRenamingPath();
    if (path == null) {
      return;
    }
    const result = this.controller.commitRename(
      path,
      this.controller.getRenameDraft()
    );
    if (!result.ok) {
      // Invalid or colliding names revert (Pierre commits-or-reverts on
      // blur; we mirror that for Enter too rather than trapping focus).
      this.controller.cancelRename();
    }
  }

  /**
   * The rename-handoff half of the Pierre pattern: the controller owns the
   * session, so whenever the renaming row (re)enters the window the freshly
   * created input is re-focused and — only right after the session began —
   * select-all'd. While the row is scrolled out there is simply no input.
   */
  private restoreRenameFocus(): void {
    if (this.controller.getRenamingPath() == null) {
      this.renameSelectAllPending = false;
      return;
    }
    const input = this.rowsElement?.querySelector('[data-rename-input]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const shadowRoot = this.container?.shadowRoot;
    if (shadowRoot?.activeElement !== input) {
      input.focus();
    }
    if (this.renameSelectAllPending) {
      input.select();
      this.renameSelectAllPending = false;
    }
  }

  private handleInput = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.matches('[data-rename-input]')
    ) {
      this.controller.setRenameDraft(target.value);
    }
  };

  // Blur commits (Pierre's RenameInput behavior) — but only real blurs:
  // window rewrites destroying the input set suppressRenameCommit first.
  private handleFocusOut = (event: Event): void => {
    if (this.suppressRenameCommit) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.matches('[data-rename-input]') &&
      this.controller.getRenamingPath() != null
    ) {
      this.commitRenameFromView();
    }
  };

  // --- Drag & drop (HTML5) -----------------------------------------------------------------

  private handleDragStart = (event: Event): void => {
    const row = getRowFromEvent(event);
    if (row == null || row.getAttribute('data-sticky-row') === 'true') {
      return;
    }
    const path = this.getRowPath(row);
    if (path == null) {
      return;
    }
    // Dragging a selected row drags the whole selection (batch move);
    // dragging an unselected row drags just it, leaving selection alone.
    const selected = this.controller.getSelectedPaths();
    this.dragPaths = selected.includes(path) ? selected : [path];
    this.dropTargetPath = null;
    const dataTransfer = (event as DragEvent).dataTransfer;
    if (dataTransfer != null) {
      dataTransfer.effectAllowed = 'move';
      dataTransfer.setData('text/plain', this.dragPaths.join('\n'));
    }
    this.patchDragStates();
  };

  private handleDragOver = (event: Event): void => {
    if (this.dragPaths == null) {
      return;
    }
    const row = getRowFromEvent(event);
    const targetPath = this.getRowDropTargetPath(row);
    if (targetPath == null) {
      this.setDropTarget(null);
      return;
    }
    // Only allow the drop when at least one dragged path survives the guard
    // set (self/descendant/parent/collision) — invalid targets show nothing.
    if (this.controller.getMovePlan(this.dragPaths, targetPath).length === 0) {
      this.setDropTarget(null);
      return;
    }
    event.preventDefault();
    const dataTransfer = (event as DragEvent).dataTransfer;
    if (dataTransfer != null) {
      dataTransfer.dropEffect = 'move';
    }
    this.setDropTarget(targetPath);
  };

  private handleDragLeave = (event: Event): void => {
    const row = getRowFromEvent(event);
    if (row != null && this.getRowPath(row) === this.dropTargetPath) {
      this.setDropTarget(null);
    }
  };

  private handleDrop = (event: Event): void => {
    if (this.dragPaths == null) {
      return;
    }
    const row = getRowFromEvent(event);
    const targetPath = this.getRowDropTargetPath(row);
    if (targetPath != null) {
      event.preventDefault();
      // movePaths fires the controller's onMove, which startListening
      // forwards to the view's onMove option.
      this.controller.movePaths(this.dragPaths, targetPath);
    }
    this.endDragSession();
  };

  private handleDragEnd = (): void => {
    this.endDragSession();
  };

  // Valid drop targets are group rows (including flattened chains, whose
  // path is the chain's deepest group). Sticky mirrors and leaves are not
  // targets.
  private getRowDropTargetPath(row: HTMLElement | undefined): string | null {
    if (
      row == null ||
      row.getAttribute('data-sticky-row') === 'true' ||
      row.getAttribute('data-kind') !== 'group'
    ) {
      return null;
    }
    return this.getRowPath(row);
  }

  // Tracks the highlighted target and arms the spring-loaded expansion: a
  // collapsed group hovered for the configured delay auto-expands so drags
  // can descend into closed subtrees (Pierre's openOnDropDelay behavior).
  private setDropTarget(path: string | null): void {
    if (this.dropTargetPath === path) {
      return;
    }
    this.dropTargetPath = path;
    this.clearDragExpandTimer();
    if (path != null && !this.controller.isExpanded(path)) {
      this.dragExpandTimer = setTimeout(() => {
        this.dragExpandTimer = undefined;
        if (
          this.dropTargetPath === path &&
          this.dragPaths != null &&
          !this.controller.isExpanded(path)
        ) {
          this.controller.setExpanded(path, true);
        }
      }, this.options.dragExpandDelayMs ?? DRAG_EXPAND_DELAY_MS);
    }
    this.patchDragStates();
  }

  private endDragSession(): void {
    this.dragPaths = null;
    this.dropTargetPath = null;
    this.clearDragExpandTimer();
    this.patchDragStates();
  }

  private clearDragExpandTimer(): void {
    if (this.dragExpandTimer != null) {
      clearTimeout(this.dragExpandTimer);
      this.dragExpandTimer = undefined;
    }
  }

  /**
   * Applies drag visuals as attribute patches on the rendered rows (dragged
   * rows dim, the valid target tints), and re-applies them after window
   * rewrites so a spring-loaded expansion mid-drag keeps the highlights.
   */
  private patchDragStates(): void {
    const { rowsElement } = this;
    if (rowsElement == null) {
      return;
    }
    const dragSet = new Set(this.dragPaths ?? []);
    for (const element of rowsElement.children) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const path = this.getRowPath(element);
      if (path == null) {
        continue;
      }
      if (dragSet.has(path)) {
        element.setAttribute('data-dragging', 'true');
      } else {
        element.removeAttribute('data-dragging');
      }
      if (this.dropTargetPath === path) {
        element.setAttribute('data-drop-target', 'true');
      } else {
        element.removeAttribute('data-drop-target');
      }
    }
  }

  private getRowPath(row: HTMLElement): string | null {
    const raw = row.getAttribute('data-row-index');
    if (raw == null) {
      return null;
    }
    const index = Number(raw);
    if (Number.isNaN(index)) {
      return null;
    }
    return this.controller.getVisiblePaths()[index] ?? null;
  }
}

// Events inside a shadow root have their target retargeted at the shadow
// boundary only for outside listeners; our listeners live inside, so
// closest() from the raw target resolves the row element directly.
function getRowFromEvent(event: Event): HTMLElement | undefined {
  const { target } = event;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const row = target.closest('[data-row]');
  return row instanceof HTMLElement ? row : undefined;
}

function queryElement(
  root: HTMLElement,
  selector: string
): HTMLElement | undefined {
  const element = root.querySelector(selector);
  return element instanceof HTMLElement ? element : undefined;
}
