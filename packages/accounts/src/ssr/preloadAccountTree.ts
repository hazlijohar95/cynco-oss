import { DEFAULT_CURRENCY, SSR_MAX_PRELOADED_ROWS } from '../constants';
import { AccountTreeController } from '../model/AccountTreeController';
import {
  renderAccountRowsHTML,
  renderAccountTreeShellHTML,
} from '../render/AccountTreeRenderer';
import styles from '../style.css?inline';
import type { AccountTreeControllerOptions } from '../types';

export interface PreloadAccountTreeOptions extends AccountTreeControllerOptions {
  /** Must match the client `AccountTree` id so hydrated row ids line up. */
  id?: string;
  /** Accessible name for the tree. Default `Accounts`. */
  ariaLabel?: string;
  /**
   * Number of leading rows to pre-render. Clamped to
   * `SSR_MAX_PRELOADED_ROWS` (512) — the deferred-projection cap: the server
   * cannot know the viewport, so it renders a bounded leading window and the
   * client re-windows on its first scroll.
   */
  initialWindowRows?: number;
}

/**
 * Produces the shadow-root HTML for an account tree: stylesheet, scroller
 * shell, sticky-header slot, and the leading row window with a correctly
 * sized after-spacer so scrollbar geometry is right before hydration. Reuses
 * the exact same pure renderer as the client, so `hydrate` can adopt the
 * structure in place without a rebuild.
 */
export function preloadAccountTreeHTML(
  options: PreloadAccountTreeOptions = {}
): Promise<string> {
  const {
    id,
    ariaLabel = 'Accounts',
    initialWindowRows = SSR_MAX_PRELOADED_ROWS,
    ...controllerOptions
  } = options;
  const controller = new AccountTreeController(controllerOptions);
  const totalCount = controller.getVisibleCount();
  const windowRows = Math.max(
    0,
    Math.min(totalCount, initialWindowRows, SSR_MAX_PRELOADED_ROWS)
  );
  const range = { start: 0, end: windowRows };
  const rowsHTML = renderAccountRowsHTML(
    controller.getRows(range.start, range.end),
    range,
    {
      currency: controllerOptions.currency ?? DEFAULT_CURRENCY,
      showBalances: controllerOptions.showBalances,
      amountFormat: controllerOptions.amountFormat,
      idPrefix: id,
    }
  );
  return Promise.resolve(
    `<style>${styles}</style>` +
      renderAccountTreeShellHTML({
        rowsHTML,
        range,
        totalCount,
        rowHeight: controller.getRowHeight(),
        density: controller.getDensity(),
        ariaLabel,
      })
  );
}
