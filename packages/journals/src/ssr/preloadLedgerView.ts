import type { LedgerSection } from '../components/LedgerView';
import {
  DEFAULT_LINE_HEIGHT,
  SSR_MAX_PRELOADED_ROWS_PER_SECTION,
  SSR_MAX_PRELOADED_TOTAL_ROWS,
} from '../constants';
import {
  finalRegisterBalances,
  renderRegisterEmptyStateHTML,
  renderRegisterHeaderHTML,
  renderRegisterRowsHTML,
} from '../renderers/RegisterRenderer';
import styles from '../style.css?inline';
import type { AmountFormat, RegisterDensity } from '../types';
import { escapeHtml } from '../utils/escapeHtml';

export interface PreloadLedgerViewOptions {
  /**
   * Stable view id threaded into per-section row ids as `{id}-s{index}`.
   * Pass the SAME id to the client `LedgerView` (options.id) so the
   * hydrated instance reproduces the ids the preload emitted — the
   * Register/AccountTree id contract, one level up.
   */
  id?: string;
  /** Row density shared by every section. Default `comfortable`. */
  density?: RegisterDensity;
  /** Must match `--journals-line-height` (default 20). */
  lineHeight?: number;
  /** Per-section row cap; defaults to SSR_MAX_PRELOADED_ROWS_PER_SECTION. */
  maxRowsPerSection?: number;
  /** Total row cap across sections; defaults to SSR_MAX_PRELOADED_TOTAL_ROWS. */
  maxTotalRows?: number;
  /**
   * Guidance text for zero-row sections. Must match the client
   * LedgerView's `emptyLabel` option so the SSR bytes agree with what the
   * hydrated Register's first window commit writes.
   */
  emptyLabel?: string;
  /**
   * Amount separators/grouping for every section. Must match the client
   * LedgerView's `amountFormat` option — the same plain-data descriptor on
   * both sides is what keeps SSR and hydrated bytes identical (never
   * resolve it from Intl on the server; see `resolveAmountFormat`).
   */
  amountFormat?: AmountFormat;
}

// Produces the shadow-root HTML for a LedgerView (the preloadRegister
// contract, one level up): the shared scroller/content shell, then one
// section per account — sticky header plus its LEADING rows, capped both
// per section (SSR_MAX_PRELOADED_ROWS_PER_SECTION) and across the whole
// view (SSR_MAX_PRELOADED_TOTAL_ROWS, so a 50-account view cannot preload
// thousands of rows). Rows past a cap are represented by an exactly sized
// after-spacer, so pre-hydration scrollbar geometry matches what the
// hydrated client computes and hydration causes no scroll jump.
export function preloadLedgerViewHTML(
  sections: readonly LedgerSection[],
  options: PreloadLedgerViewOptions = {}
): Promise<string> {
  const {
    density = 'comfortable',
    lineHeight = DEFAULT_LINE_HEIGHT,
    maxRowsPerSection = SSR_MAX_PRELOADED_ROWS_PER_SECTION,
    maxTotalRows = SSR_MAX_PRELOADED_TOTAL_ROWS,
  } = options;
  const rowHeight = density === 'compact' ? lineHeight : lineHeight * 2;
  let totalBudget = Math.max(0, maxTotalRows);

  let html = `<style>${styles}</style>`;
  html += '<div data-scroller data-ledger-view><div data-journals-content>';
  for (const [index, section] of sections.entries()) {
    // Leading sections win the shared budget: they are what the user sees
    // before hydration takes over.
    const preloadCount = Math.min(
      section.rows.length,
      Math.max(0, maxRowsPerSection),
      totalBudget
    );
    totalBudget -= preloadCount;
    const idPrefix = options.id != null ? `${options.id}-s${index}` : undefined;
    html += renderLedgerSectionHTML(
      section,
      idPrefix,
      density,
      preloadCount,
      (section.rows.length - preloadCount) * rowHeight,
      options.emptyLabel,
      options.amountFormat
    );
  }
  html += '</div></div>';
  return Promise.resolve(html);
}

// One section shell, mirroring renderRegisterHTML's grid attributes byte
// for byte (LedgerView sections are always flat/ungrouped): the hydrating
// Register re-applies the same attributes, so adoption performs no
// observable DOM change. aria-rowcount reports the FULL row count — the
// grid semantically has every row; the cap only limits materialized DOM,
// exactly like client-side virtualization.
function renderLedgerSectionHTML(
  section: LedgerSection,
  idPrefix: string | undefined,
  density: RegisterDensity,
  preloadCount: number,
  afterSpacerHeight: number,
  emptyLabel: string | undefined,
  amountFormat: AmountFormat | undefined
): string {
  const { account, rows } = section;
  const balance = finalRegisterBalances(rows);
  let html =
    `<section data-register data-density="${density}" role="grid"` +
    ` aria-label="${escapeHtml(account)}"` +
    ` aria-rowcount="${rows.length}"` +
    ' tabindex="0">';
  html += renderRegisterHeaderHTML(account, balance, amountFormat);
  html += '<div data-register-body>';
  html += '<div data-register-spacer="before" style="height: 0px"></div>';
  html += '<div data-register-rows>';
  // Zero-row sections preload the same empty state the hydrated Register's
  // first window commit writes (renderRegisterHTML's zero-row branch), so
  // adoption rewrites identical bytes.
  html +=
    rows.length === 0
      ? renderRegisterEmptyStateHTML(emptyLabel)
      : renderRegisterRowsHTML(
          rows,
          { start: 0, end: preloadCount },
          null,
          idPrefix,
          0,
          amountFormat
        );
  html += '</div>';
  html += `<div data-register-spacer="after" style="height: ${afterSpacerHeight}px"></div>`;
  html += '</div></section>';
  return html;
}
