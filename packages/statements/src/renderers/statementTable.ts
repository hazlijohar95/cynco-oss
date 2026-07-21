// Shared building blocks for the income statement and balance sheet string
// renderers. Both statements are the same table grammar — an account column
// plus N amount columns, grouped into sections with a group header, line
// rows, and a group total — so the grammar lives here once and the two
// renderers stay purely declarative about their domain structure.

import type {
  AmountFormat,
  MinorUnits,
  StatementLine,
  UnclassifiedBalance,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';

/**
 * One amount cell per column. Line rows render zero as an empty cell (the
 * quiet monochrome reading of "no activity"); totals and proof rows pass
 * `alwaysShow` because a proof line must state its value, including 0.00.
 * Negative amounts format with the proper U+2212 minus — presentation signs
 * were already applied by the derivation, the renderer never re-signs.
 */
export function renderAmountCellsHTML(
  amounts: readonly MinorUnits[],
  currency: string,
  columnPrefix: string,
  alwaysShow = false,
  amountFormat?: AmountFormat
): string {
  let html = '';
  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    const text =
      amount === 0 && !alwaysShow
        ? ''
        : formatMinorUnits(amount, currency, { format: amountFormat });
    html += `<td data-cell="${columnPrefix}-${index}">${text}</td>`;
  }
  return html;
}

/** A group header row spanning the whole table (`Income`, `Assets`, …). */
export function renderGroupHeaderHTML(
  label: string,
  columnCount: number
): string {
  return (
    `<tr data-group-header><th scope="colgroup" colspan="${columnCount}">` +
    `${escapeHtml(label)}</th></tr>`
  );
}

/** One account line row inside a group. */
export function renderLineRowHTML(
  line: StatementLine,
  currency: string,
  columnPrefix: string,
  amountFormat?: AmountFormat
): string {
  return (
    `<tr data-row data-account="${escapeHtml(line.account)}">` +
    `<th scope="row" data-cell="account">${escapeHtml(line.account)}</th>` +
    renderAmountCellsHTML(
      line.amounts,
      currency,
      columnPrefix,
      false,
      amountFormat
    ) +
    '</tr>'
  );
}

/** A group total row (`Total Income`, `Total Assets`, …); always shows values. */
export function renderGroupTotalHTML(
  label: string,
  totalKey: string,
  totals: readonly MinorUnits[],
  currency: string,
  columnPrefix: string,
  amountFormat?: AmountFormat
): string {
  return (
    `<tr data-group-total data-total="${totalKey}">` +
    `<th scope="row" data-cell="total-label">${escapeHtml(label)}</th>` +
    renderAmountCellsHTML(totals, currency, columnPrefix, true, amountFormat) +
    '</tr>'
  );
}

/**
 * The unclassified residue as its own flagged group. Amounts here are raw
 * ledger-signed (no section, so no presentation flip applied) and excluded
 * from every total — surfaced, never guessed into a section or hidden.
 */
export function renderUnclassifiedGroupHTML(
  unclassified: readonly UnclassifiedBalance[],
  currency: string,
  columnPrefix: string,
  columnCount: number,
  amountFormat?: AmountFormat
): string {
  if (unclassified.length === 0) {
    return '';
  }
  let html = '<tbody data-group="unclassified">';
  html += renderGroupHeaderHTML('Unclassified', columnCount);
  for (const balance of unclassified) {
    html +=
      `<tr data-row data-unclassified data-account="${escapeHtml(balance.account)}">` +
      `<th scope="row" data-cell="account">${escapeHtml(balance.account)}</th>` +
      renderAmountCellsHTML(
        balance.amounts,
        currency,
        columnPrefix,
        false,
        amountFormat
      ) +
      '</tr>';
  }
  html += '</tbody>';
  return html;
}
