import type {
  AmountFormat,
  TrialBalanceData,
  TrialBalanceRow,
  TrialBalanceSection,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { warnIfInvalidTrialBalanceAmounts } from '../utils/minorUnitsBoundary';

export interface TrialBalanceRenderOptions {
  /**
   * Adds a subtle classification column (asset, liability, …) between the
   * account path and the amount columns. Unclassified rows label themselves
   * honestly instead of guessing a type. Default false.
   */
  showClassification?: boolean;
  /**
   * Separator/grouping descriptor for every amount (see
   * {@link AmountFormat}). Default AMOUNT_FORMAT_COMMA_DOT — the original
   * `1,234.56` bytes. Plain data so server and client format from the same
   * descriptor (never from Intl — the byte-parity contract). Debit/credit
   * column semantics and the U+2212 imbalance sign are unaffected.
   */
  amountFormat?: AmountFormat;
}

// Renders a TrialBalanceData as an HTML string: one semantic <table> per
// currency section inside a [data-trial-balance] wrapper. This is the single
// renderer shared by the client component (TrialBalance sets innerHTML from
// it) and any future SSR preload, so client output and server output can
// never drift apart. It must therefore stay a pure string builder — no DOM
// APIs. Every element that carries meaning gets a data- attribute (the house
// pattern for testability), all text passes through escapeHtml, and amounts
// render sign-'never' because the debit/credit column carries the sign
// semantics.
export function renderTrialBalanceHTML(
  data: TrialBalanceData,
  options: TrialBalanceRenderOptions = {}
): string {
  // Boundary check on the data crossing into rendering: this renderer is
  // the single choke point derived data passes through (the TrialBalance
  // component reference-gates its calls, so this runs once per new data;
  // direct/SSR callers pay one capped integer scan on a function that
  // already walks every row). A console side channel only — the returned
  // string is byte-identical whether or not the warning fires, so the
  // pure-string-builder/byte-parity contract holds.
  warnIfInvalidTrialBalanceAmounts('renderTrialBalanceHTML', data);
  const showClassification = options.showClassification ?? false;
  const asOfAttribute =
    data.asOf == null ? '' : ` data-as-of="${escapeHtml(data.asOf)}"`;
  let html = `<div data-trial-balance${asOfAttribute}>`;
  for (const section of data.sections) {
    html += renderSectionHTML(
      section,
      data.asOf,
      showClassification,
      options.amountFormat
    );
  }
  html += '</div>';
  return html;
}

// One currency section as a <table>. Working-trial-balance mode (any row
// carrying unadjusted/adjustment splits) widens the two amount columns to
// six: unadjusted, adjustments, and adjusted debit/credit pairs.
function renderSectionHTML(
  section: TrialBalanceSection,
  asOf: string | null,
  showClassification: boolean,
  amountFormat?: AmountFormat
): string {
  // Adjustment splits are all-or-nothing per derivation (deriveTrialBalance
  // fills them on every row when adjustments are configured), so probing the
  // first row decides the column layout for the whole section.
  const working = section.rows.length > 0 && section.rows[0].unadjusted != null;
  const amountColumnCount = working ? 6 : 2;
  const columnCount = 1 + (showClassification ? 1 : 0) + amountColumnCount;

  const overflowAttribute = section.hasOverflow ? ' data-overflow' : '';
  const workingAttribute = working ? ' data-working' : '';
  let html =
    `<table data-section data-currency="${escapeHtml(section.currency)}"` +
    ` data-balanced="${section.balanced}"${workingAttribute}${overflowAttribute}>`;
  html += renderCaptionHTML(section.currency, asOf);
  html += renderHeadHTML(working, showClassification);
  html += '<tbody>';
  for (const row of section.rows) {
    html += renderRowHTML(
      row,
      section.currency,
      working,
      showClassification,
      amountFormat
    );
  }
  html += '</tbody>';
  html += renderFootHTML(
    section,
    working,
    showClassification,
    columnCount,
    amountFormat
  );
  html += '</table>';
  return html;
}

// Caption: "Trial Balance — MYR", plus the as-of date when the derivation
// was bounded. The caption doubles as the table's accessible name.
function renderCaptionHTML(currency: string, asOf: string | null): string {
  let caption = `Trial Balance \u2014 ${escapeHtml(currency)}`;
  if (asOf != null) {
    caption += `<span data-as-of-date> as of ${escapeHtml(asOf)}</span>`;
  }
  return `<caption data-caption>${caption}</caption>`;
}

function renderHeadHTML(working: boolean, showClassification: boolean): string {
  let html = '<thead><tr>';
  html += '<th scope="col" data-column="account">Account</th>';
  if (showClassification) {
    html += '<th scope="col" data-column="type">Type</th>';
  }
  if (working) {
    html += '<th scope="col" data-column="unadjusted-debit">Unadjusted Dr</th>';
    html +=
      '<th scope="col" data-column="unadjusted-credit">Unadjusted Cr</th>';
    html +=
      '<th scope="col" data-column="adjustments-debit">Adjustments Dr</th>';
    html +=
      '<th scope="col" data-column="adjustments-credit">Adjustments Cr</th>';
    html += '<th scope="col" data-column="adjusted-debit">Adjusted Dr</th>';
    html += '<th scope="col" data-column="adjusted-credit">Adjusted Cr</th>';
  } else {
    html += '<th scope="col" data-column="debit">Debit</th>';
    html += '<th scope="col" data-column="credit">Credit</th>';
  }
  html += '</tr></thead>';
  return html;
}

// One account row. The debit/credit pair renders a signed balance into the
// conventional columns: positive lands in debit, negative (negated) in
// credit, and the other cell stays empty — the column carries the sign, so
// amounts format with sign 'never'.
function renderRowHTML(
  row: TrialBalanceRow,
  currency: string,
  working: boolean,
  showClassification: boolean,
  amountFormat?: AmountFormat
): string {
  const abnormalAttribute = row.abnormal ? ' data-abnormal' : '';
  const unclassifiedAttribute =
    row.classification == null ? ' data-unclassified' : '';
  let html =
    `<tr data-row data-account="${escapeHtml(row.account)}"` +
    `${abnormalAttribute}${unclassifiedAttribute}>`;
  html += `<th scope="row" data-cell="account">${escapeHtml(row.account)}</th>`;
  if (showClassification) {
    const label =
      row.classification == null
        ? 'unclassified'
        : row.classification.contra
          ? `contra ${row.classification.type}`
          : row.classification.type;
    html += `<td data-cell="type">${escapeHtml(label)}</td>`;
  }
  if (working) {
    html += renderAmountPairHTML(
      row.unadjusted ?? 0,
      currency,
      'unadjusted',
      amountFormat
    );
    html += renderAmountPairHTML(
      row.adjustment ?? 0,
      currency,
      'adjustments',
      amountFormat
    );
    html += renderAmountPairHTML(
      row.balance,
      currency,
      'adjusted',
      amountFormat
    );
  } else {
    html += renderAmountPairHTML(row.balance, currency, '', amountFormat);
  }
  html += '</tr>';
  return html;
}

// A debit/credit cell pair for one signed amount. Zero renders both cells
// empty — a zero-activity chart account reads as blank, not as 0.00 in an
// arbitrary column.
function renderAmountPairHTML(
  amount: number,
  currency: string,
  columnPrefix: string,
  amountFormat?: AmountFormat
): string {
  const debitColumn = columnPrefix === '' ? 'debit' : `${columnPrefix}-debit`;
  const creditColumn =
    columnPrefix === '' ? 'credit' : `${columnPrefix}-credit`;
  const debit =
    amount > 0
      ? formatMinorUnits(amount, currency, {
          sign: 'never',
          format: amountFormat,
        })
      : '';
  const credit =
    amount < 0
      ? formatMinorUnits(-amount, currency, {
          sign: 'never',
          format: amountFormat,
        })
      : '';
  return (
    `<td data-cell="${debitColumn}">${debit}</td>` +
    `<td data-cell="${creditColumn}">${credit}</td>`
  );
}

// Totals row plus — when the section does not balance — a visible imbalance
// row carrying the signed difference. Flag, never hide: the data layer owns
// correctness, the renderer owns visibility, and no plug is ever invented to
// make the columns tie.
function renderFootHTML(
  section: TrialBalanceSection,
  working: boolean,
  showClassification: boolean,
  columnCount: number,
  amountFormat?: AmountFormat
): string {
  const totalDebit = formatMinorUnits(section.totalDebit, section.currency, {
    sign: 'never',
    format: amountFormat,
  });
  const totalCredit = formatMinorUnits(section.totalCredit, section.currency, {
    sign: 'never',
    format: amountFormat,
  });
  let html = '<tfoot>';
  html += `<tr data-totals data-balanced="${section.balanced}">`;
  html += '<th scope="row" data-cell="totals-label">Totals</th>';
  if (showClassification) {
    html += '<td data-cell="type"></td>';
  }
  if (working) {
    // Working mode totals apply to the adjusted columns; the unadjusted and
    // adjustment columns stay blank rather than implying totals the
    // derivation did not compute.
    html += '<td data-cell="unadjusted-debit"></td>';
    html += '<td data-cell="unadjusted-credit"></td>';
    html += '<td data-cell="adjustments-debit"></td>';
    html += '<td data-cell="adjustments-credit"></td>';
    html += `<td data-cell="adjusted-debit" data-total="debit">${totalDebit}</td>`;
    html += `<td data-cell="adjusted-credit" data-total="credit">${totalCredit}</td>`;
  } else {
    html += `<td data-cell="debit" data-total="debit">${totalDebit}</td>`;
    html += `<td data-cell="credit" data-total="credit">${totalCredit}</td>`;
  }
  html += '</tr>';
  if (!section.balanced) {
    const difference = section.totalDebit - section.totalCredit;
    html += '<tr data-imbalance>';
    html += '<th scope="row" data-cell="imbalance-label">Out of balance</th>';
    html +=
      `<td data-cell="imbalance-amount" colspan="${columnCount - 1}">` +
      `<span data-imbalance-amount>${formatMinorUnits(difference, section.currency, { sign: 'always', format: amountFormat })} ${escapeHtml(section.currency)}</span>` +
      '</td>';
    html += '</tr>';
  }
  html += '</tfoot>';
  return html;
}
