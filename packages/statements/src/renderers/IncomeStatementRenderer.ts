// Income statement (P&L) string renderer: one semantic <table> per currency
// section inside a [data-income-statement] wrapper, one amount column per
// reporting period. Shared by the client component and any future SSR
// preload, so it must stay a pure string builder — no DOM APIs.
//
// The derivation already applied the presentation sign flip (revenue
// positive, contra income negative); this renderer only lays the numbers
// out. Unclassified activity renders as a flagged group and is excluded from
// every total — flag, never guess, never hide.

import type {
  AmountFormat,
  IncomeStatementData,
  IncomeStatementSection,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { warnIfInvalidIncomeStatementAmounts } from '../utils/minorUnitsBoundary';
import {
  renderAmountCellsHTML,
  renderGroupHeaderHTML,
  renderGroupTotalHTML,
  renderLineRowHTML,
  renderUnclassifiedGroupHTML,
} from './statementTable';

export interface IncomeStatementRenderOptions {
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
 * Renders a derived {@link IncomeStatementData} as an HTML string. Every
 * element carrying meaning gets a data- attribute (the house testability
 * pattern) and all text passes through escapeHtml.
 */
export function renderIncomeStatementHTML(
  data: IncomeStatementData,
  options: IncomeStatementRenderOptions = {}
): string {
  // Boundary check on the data crossing into rendering (see the note in
  // renderTrialBalanceHTML): console side channel only, output bytes are
  // identical whether or not the warning fires.
  warnIfInvalidIncomeStatementAmounts('renderIncomeStatementHTML', data);
  let html = '<div data-income-statement>';
  for (const section of data.sections) {
    html += renderSectionHTML(
      section,
      data.periods.map((p) => p.label),
      options.amountFormat
    );
  }
  html += '</div>';
  return html;
}

function renderSectionHTML(
  section: IncomeStatementSection,
  periodLabels: readonly string[],
  amountFormat?: AmountFormat
): string {
  const columnCount = 1 + periodLabels.length;
  const overflowAttribute = section.hasOverflow ? ' data-overflow' : '';
  let html =
    `<table data-section data-currency="${escapeHtml(section.currency)}"` +
    `${overflowAttribute}>`;
  html +=
    `<caption data-caption>Income Statement \u2014 ` +
    `${escapeHtml(section.currency)}</caption>`;

  html += '<thead><tr>';
  html += '<th scope="col" data-column="account">Account</th>';
  for (let index = 0; index < periodLabels.length; index += 1) {
    html +=
      `<th scope="col" data-column="period-${index}">` +
      `${escapeHtml(periodLabels[index])}</th>`;
  }
  html += '</tr></thead>';

  html += '<tbody data-group="income">';
  html += renderGroupHeaderHTML('Income', columnCount);
  for (const line of section.income) {
    html += renderLineRowHTML(line, section.currency, 'period', amountFormat);
  }
  html += renderGroupTotalHTML(
    'Total Income',
    'income',
    section.totalIncome,
    section.currency,
    'period',
    amountFormat
  );
  html += '</tbody>';

  html += '<tbody data-group="expenses">';
  html += renderGroupHeaderHTML('Expenses', columnCount);
  for (const line of section.expenses) {
    html += renderLineRowHTML(line, section.currency, 'period', amountFormat);
  }
  html += renderGroupTotalHTML(
    'Total Expenses',
    'expenses',
    section.totalExpenses,
    section.currency,
    'period',
    amountFormat
  );
  html += '</tbody>';

  html += renderUnclassifiedGroupHTML(
    section.unclassified,
    section.currency,
    'period',
    columnCount,
    amountFormat
  );

  // The proof line: net income always states its value (including 0.00) and
  // renders under the classic double rule.
  html += '<tfoot>';
  html += '<tr data-net-income>';
  html += '<th scope="row" data-cell="net-income-label">Net Income</th>';
  html += renderAmountCellsHTML(
    section.netIncome,
    section.currency,
    'period',
    true,
    amountFormat
  );
  html += '</tr>';
  html += '</tfoot>';

  html += '</table>';
  return html;
}
