// Balance sheet string renderer: one semantic <table> per currency section
// inside a [data-balance-sheet] wrapper, one amount column per reporting
// date. Shared by the client component and any future SSR preload, so it
// must stay a pure string builder — no DOM APIs.
//
// The equity group carries the derivation's virtual closing as visibly
// computed rows (data-computed): retained earnings always, current-year
// earnings when any column has a fiscal-year split or a nonzero value. When
// the accounting equation does not hold on some date the renderer shows the
// per-column difference in a flagged row — it never invents a plug to make
// assets tie to liabilities plus equity.

import type {
  AmountFormat,
  BalanceSheetData,
  BalanceSheetSection,
  StatementDate,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import {
  renderAmountCellsHTML,
  renderGroupHeaderHTML,
  renderGroupTotalHTML,
  renderLineRowHTML,
  renderUnclassifiedGroupHTML,
} from './statementTable';

export interface BalanceSheetRenderOptions {
  /**
   * Separator/grouping descriptor for every amount (see
   * {@link AmountFormat}). Default AMOUNT_FORMAT_COMMA_DOT — the original
   * `1,234.56` bytes. Plain data so server and client format from the same
   * descriptor (never from Intl — the byte-parity contract). Presentation
   * signs and the U+2212 minus are unaffected.
   */
  amountFormat?: AmountFormat;
}

/**
 * Renders a derived {@link BalanceSheetData} as an HTML string. Every
 * element carrying meaning gets a data- attribute (the house testability
 * pattern) and all text passes through escapeHtml.
 */
export function renderBalanceSheetHTML(
  data: BalanceSheetData,
  options: BalanceSheetRenderOptions = {}
): string {
  let html = '<div data-balance-sheet>';
  for (const section of data.sections) {
    html += renderSectionHTML(section, data.dates, options.amountFormat);
  }
  html += '</div>';
  return html;
}

function renderSectionHTML(
  section: BalanceSheetSection,
  dates: readonly StatementDate[],
  amountFormat?: AmountFormat
): string {
  const columnCount = 1 + dates.length;
  const allBalanced = section.balancedByDate.every((balanced) => balanced);
  const overflowAttribute = section.hasOverflow ? ' data-overflow' : '';
  let html =
    `<table data-section data-currency="${escapeHtml(section.currency)}"` +
    ` data-balanced="${allBalanced}"${overflowAttribute}>`;
  html +=
    `<caption data-caption>Balance Sheet \u2014 ` +
    `${escapeHtml(section.currency)}</caption>`;

  html += '<thead><tr>';
  html += '<th scope="col" data-column="account">Account</th>';
  for (let index = 0; index < dates.length; index += 1) {
    html +=
      `<th scope="col" data-column="date-${index}">` +
      `${escapeHtml(dates[index].label)}</th>`;
  }
  html += '</tr></thead>';

  html += '<tbody data-group="assets">';
  html += renderGroupHeaderHTML('Assets', columnCount);
  for (const line of section.assets) {
    html += renderLineRowHTML(line, section.currency, 'date', amountFormat);
  }
  html += renderGroupTotalHTML(
    'Total Assets',
    'assets',
    section.totalAssets,
    section.currency,
    'date',
    amountFormat
  );
  html += '</tbody>';

  html += '<tbody data-group="liabilities">';
  html += renderGroupHeaderHTML('Liabilities', columnCount);
  for (const line of section.liabilities) {
    html += renderLineRowHTML(line, section.currency, 'date', amountFormat);
  }
  html += renderGroupTotalHTML(
    'Total Liabilities',
    'liabilities',
    section.totalLiabilities,
    section.currency,
    'date',
    amountFormat
  );
  html += '</tbody>';

  html += '<tbody data-group="equity">';
  html += renderGroupHeaderHTML('Equity', columnCount);
  for (const line of section.equity) {
    html += renderLineRowHTML(line, section.currency, 'date', amountFormat);
  }
  // The virtual closing, visibly computed: retained earnings is structural
  // (it is what makes the statement balance) so it always renders, stating
  // its value even at zero.
  html += renderComputedRowHTML(
    'Retained earnings',
    'retained-earnings',
    section.retainedEarnings,
    section.currency,
    amountFormat
  );
  if (shouldRenderCurrentEarnings(section, dates)) {
    html += renderComputedRowHTML(
      'Current year earnings',
      'current-earnings',
      section.currentEarnings,
      section.currency,
      amountFormat
    );
  }
  html += renderGroupTotalHTML(
    'Total Equity',
    'equity',
    section.totalEquity,
    section.currency,
    'date',
    amountFormat
  );
  html += '</tbody>';

  html += renderUnclassifiedGroupHTML(
    section.unclassified,
    section.currency,
    'date',
    columnCount,
    amountFormat
  );

  html += '<tfoot>';
  html += renderGroupTotalHTML(
    'Total Liabilities & Equity',
    'liabilities-equity',
    section.totalLiabilities.map(
      (value, index) => value + section.totalEquity[index]
    ),
    section.currency,
    'date',
    amountFormat
  );
  if (!allBalanced) {
    html += renderImbalanceRowHTML(section, amountFormat);
  }
  html += '</tfoot>';

  html += '</table>';
  return html;
}

// A computed equity line (the virtual closing). data-computed lets styles
// and tests distinguish derived lines from booked equity accounts.
function renderComputedRowHTML(
  label: string,
  key: string,
  amounts: readonly number[],
  currency: string,
  amountFormat?: AmountFormat
): string {
  return (
    `<tr data-row data-computed="${key}">` +
    `<th scope="row" data-cell="account">${escapeHtml(label)}</th>` +
    renderAmountCellsHTML(amounts, currency, 'date', true, amountFormat) +
    '</tr>'
  );
}

// Current-year earnings only means something when some column carries a
// fiscal-year split — then the row renders even at zero (a break-even year
// is a fact worth stating). Statements that never split skip the row unless
// a nonzero value somehow survived; rendering a zero row there is noise.
function shouldRenderCurrentEarnings(
  section: BalanceSheetSection,
  dates: readonly StatementDate[]
): boolean {
  return (
    dates.some((date) => date.fiscalYearStart != null) ||
    section.currentEarnings.some((value) => value !== 0)
  );
}

// Per-column accounting-equation differences, shown only on the dates that
// fail. Flag, never plug: the difference is stated with an explicit sign so
// a reviewer can see which side is heavy.
function renderImbalanceRowHTML(
  section: BalanceSheetSection,
  amountFormat?: AmountFormat
): string {
  let html = '<tr data-imbalance>';
  html += '<th scope="row" data-cell="imbalance-label">Out of balance</th>';
  for (let index = 0; index < section.balancedByDate.length; index += 1) {
    if (section.balancedByDate[index]) {
      html += `<td data-cell="date-${index}"></td>`;
      continue;
    }
    const difference =
      section.totalAssets[index] -
      (section.totalLiabilities[index] + section.totalEquity[index]);
    html +=
      `<td data-cell="date-${index}"><span data-imbalance-amount>` +
      `${formatMinorUnits(difference, section.currency, { sign: 'always', format: amountFormat })}` +
      '</span></td>';
  }
  html += '</tr>';
  return html;
}
