import type { Locator, Page } from '@playwright/test';

export interface StickyReadout {
  hidden: boolean;
  name: string | null;
  ariaHidden: string | null;
  role: string | null | undefined;
  stickyRow: string | null;
  treeitemCount: number | undefined;
}

export interface TreeReadout {
  renderedCount: number;
  before: number;
  after: number;
}

export interface RenameReadout {
  focused: boolean;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

// Every fixture page exposes a subset of these hooks; suites and helpers
// share one Window declaration so the merged global stays consistent.
declare global {
  interface Window {
    __treeStyleIsolationReady?: boolean;
    __treeVirtualizationReady?: boolean;
    __treeKeyboardReady?: boolean;
    __treeDndReady?: boolean;
    __treeFlattenReady?: boolean;
    __scroller?: HTMLElement;
    __rowHeight?: number;
    __visibleCount?: number;
    __visibleCountNow?: () => number;
    __rowIndex?: (path: string) => number;
    __focusedPath?: () => string | null;
    __selectedPaths?: () => string[];
    __isExpanded?: (path: string) => boolean;
    __hasPath?: (path: string) => boolean;
    __focusScroller?: () => void;
    __activeRename?: () => RenameReadout | null;
    __readout?: () => TreeReadout;
    __sticky?: () => StickyReadout;
    __dropTargetPath?: () => string | null;
    __moves?: { from: string; to: string }[][];
    __renames?: [string, string][];
    __setFlatten?: (value: boolean) => void;
  }
}

/**
 * Resolves the flow row (never the sticky mirror) for a canonical account
 * path via the fixture's controller-backed index readout. The index is
 * position-dependent, so re-resolve after any expansion or move.
 */
export async function rowByPath(page: Page, path: string): Promise<Locator> {
  const index = await page.evaluate(
    (target) => window.__rowIndex!(target),
    path
  );
  if (index < 0) {
    throw new Error(`rowByPath: '${path}' has no visible row`);
  }
  return page.locator(
    `accounts-container [data-rows] [data-row][data-row-index="${index}"]`
  );
}
