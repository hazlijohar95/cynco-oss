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
} from '../constants';
import { AccountTreeController } from '../model/AccountTreeController';
import type {
  AccountMoveListener,
  AccountRenameListener,
  AccountStatusEntry,
  AccountTreeChange,
  AccountTreeControllerOptions,
  ColorScheme,
  LedgerEntry,
  RowRange,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import {
  type AccountTreeRenderOptions,
  renderAccountRowsHTML,
  renderAccountTreeShellHTML,
  renderStickyRowHTML,
} from './AccountTreeRenderer';

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
    this.unsubscribeController?.();
    this.unsubscribeController = undefined;
    this.unsubscribeRename?.();
    this.unsubscribeRename = undefined;
    this.unsubscribeMove?.();
    this.unsubscribeMove = undefined;
    this.clearDragExpandTimer();
    this.dragPaths = null;
    this.dropTargetPath = null;
    if (this.scroller != null) {
      this.scroller.removeEventListener('scroll', this.handleScroll);
      this.scroller.removeEventListener('click', this.handleClick);
      this.scroller.removeEventListener('dblclick', this.handleDoubleClick);
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
  }

  private getRenderOptions(): AccountTreeRenderOptions {
    return {
      currency: this.options.currency ?? DEFAULT_CURRENCY,
      showBalances: this.options.showBalances,
      idPrefix: this.instanceId,
      renamingPath: this.controller.getRenamingPath(),
      renameDraft: this.controller.getRenameDraft(),
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
    spacerBefore.style.setProperty('height', `${range.start * rowHeight}px`);
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
    this.renderedRange = range;
    this.updateActiveDescendant();
    this.patchDragStates();
    this.restoreRenameFocus();
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
   * Sticky mirror row (v1): the nearest off-screen ancestor group of the top
   * visible row. In DFS order every proper ancestor precedes its descendants,
   * so the top row's parent is always scrolled off — show it, aria-hidden.
   */
  private updateStickyHeader(): void {
    const { stickyHeader, scroller } = this;
    if (stickyHeader == null || scroller == null) {
      return;
    }
    const rowHeight = this.controller.getRowHeight();
    const count = this.controller.getVisibleCount();
    const topIndex = Math.floor(scroller.scrollTop / rowHeight);
    if (topIndex <= 0 || count === 0) {
      stickyHeader.hidden = true;
      return;
    }
    const visible = this.controller.getVisiblePaths();
    const topPath = visible[Math.min(topIndex, count - 1)];
    // Nearest ancestor that owns a visible row: under flattening a plain
    // parent lookup could land on a hidden mid-chain group.
    const ancestorPath = this.controller.getVisibleParentPath(topPath);
    const ancestorRow =
      ancestorPath != null ? this.controller.getRow(ancestorPath) : null;
    if (ancestorRow == null) {
      stickyHeader.hidden = true;
      return;
    }
    stickyHeader.innerHTML = renderStickyRowHTML(
      ancestorRow,
      this.getRenderOptions()
    );
    stickyHeader.hidden = false;
  }

  // Adjusts scrollTop so the row at `index` is fully inside the viewport
  // (minimal movement, like Element.scrollIntoView({ block: 'nearest' })).
  private scrollRowIntoView(index: number): void {
    const { scroller } = this;
    if (scroller == null || index < 0) {
      return;
    }
    const rowHeight = this.controller.getRowHeight();
    const viewportHeight = this.getViewportHeight();
    const rowTop = index * rowHeight;
    if (rowTop < scroller.scrollTop) {
      scroller.scrollTop = rowTop;
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
    if (row == null || row.getAttribute('data-sticky-row') === 'true') {
      return;
    }
    const path = this.getRowPath(row);
    if (path == null) {
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

  private handleDoubleClick = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-rename-input]') != null
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
