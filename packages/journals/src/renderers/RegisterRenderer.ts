import type {
  MinorUnits,
  RegisterDensity,
  RegisterRowData,
  RowRange,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { renderAccountPathHTML } from '../utils/renderAccountPathHTML';
import { renderFlagDotHTML } from './EntryRenderer';

export interface RegisterRenderOptions {
  /** Canonical colon-delimited path of the account this register shows. */
  account: string;
  /**
   * Row density: `comfortable` (payee and narration stacked, 2 lines/row) or
   * `compact` (single line). Affects both CSS row height and the JS row
   * height used for window math, so it must not change between renders
   * without a full re-render.
   */
  density?: RegisterDensity;
}

// Like EntryRenderer, these are pure string builders shared by the client
// Register component (innerHTML) and the SSR preload path. No DOM APIs.

// Sticky section header: account path plus current balances (one span per
// currency present in the final running balance).
export function renderRegisterHeaderHTML(
  account: string,
  balance: ReadonlyMap<string, MinorUnits> | null
): string {
  let html = '<header data-register-header data-sticky>';
  html += `<span data-account>${renderAccountPathHTML(account)}</span>`;
  html += '<span data-register-balance>';
  if (balance != null) {
    for (const [currency, amount] of balance) {
      const negative = amount < 0 ? ' data-balance-negative="true"' : '';
      html +=
        `<span data-balance-amount${negative}>` +
        `${formatMinorUnits(amount, currency)}` +
        ` <span data-currency>${escapeHtml(currency)}</span></span>`;
    }
  }
  html += '</span></header>';
  return html;
}

// One register row: date / flag dot / payee + narration / signed amount /
// running balance. The row index is baked into a data attribute so event
// delegation can map DOM hits back to data without per-row listeners.
export function renderRegisterRowHTML(
  row: RegisterRowData,
  index: number,
  selected: boolean
): string {
  const { entry, posting } = row;
  const direction = posting.amount < 0 ? 'credit' : 'debit';
  const selectedAttribute = selected ? " data-row-selected='true'" : '';
  let html =
    `<div data-row data-row-index="${index}" data-amount="${direction}"` +
    ` data-flag="${entry.flag}"${selectedAttribute}>`;
  html += `<span data-cell="date">${escapeHtml(entry.date)}</span>`;
  html += `<span data-cell="flag">${renderFlagDotHTML(entry.flag)}</span>`;
  html += renderDescriptionCellHTML(entry.payee, entry.narration);
  html +=
    `<span data-cell="amount"><span data-amount-sign="${direction}" aria-hidden="true"></span>` +
    '<span data-amount-value>' +
    `${formatMinorUnits(posting.amount, posting.currency, { sign: 'never' })}` +
    '</span></span>';
  html += renderBalanceCellHTML(row);
  html += '</div>';
  return html;
}

// Renders the `[start, end)` slice of rows in one string so the component
// can commit a whole window with a single innerHTML write.
export function renderRegisterRowsHTML(
  rows: readonly RegisterRowData[],
  range: RowRange,
  selectedIndex: number | null
): string {
  let html = '';
  for (let index = range.start; index < range.end; index += 1) {
    html += renderRegisterRowHTML(rows[index], index, index === selectedIndex);
  }
  return html;
}

// Full register HTML for SSR: sticky header plus every row with zero-height
// spacers. The server cannot know the viewport, so it renders everything and
// the client Register re-windows on its first virtualized render pass.
export function renderRegisterHTML(
  rows: readonly RegisterRowData[],
  options: RegisterRenderOptions
): string {
  const { account, density = 'comfortable' } = options;
  const balance = rows.length > 0 ? rows[rows.length - 1].runningBalance : null;
  let html = `<section data-register data-density="${density}">`;
  html += renderRegisterHeaderHTML(account, balance);
  html += '<div data-register-body>';
  html += '<div data-register-spacer="before" style="height: 0px"></div>';
  html += '<div data-register-rows>';
  html += renderRegisterRowsHTML(rows, { start: 0, end: rows.length }, null);
  html += '</div>';
  html += '<div data-register-spacer="after" style="height: 0px"></div>';
  html += '</div></section>';
  return html;
}

// Payee is the primary description line when present; narration becomes the
// secondary line. Payee-less entries promote narration to primary so compact
// rows never render an empty first line.
function renderDescriptionCellHTML(
  payee: string | null,
  narration: string
): string {
  let html = '<span data-cell="description">';
  if (payee != null && payee !== '') {
    html += `<span data-payee>${escapeHtml(payee)}</span>`;
    if (narration !== '') {
      html += `<span data-narration>${escapeHtml(narration)}</span>`;
    }
  } else if (narration !== '') {
    html += `<span data-payee>${escapeHtml(narration)}</span>`;
  }
  html += '</span>';
  return html;
}

// Running balance in the posting's own currency. A missing currency in the
// running-balance map is bad input; render an empty cell rather than a made
// up number (graceful degradation, never silent repair).
function renderBalanceCellHTML(row: RegisterRowData): string {
  const balance = row.runningBalance.get(row.posting.currency);
  if (balance == null) {
    return '<span data-cell="balance"></span>';
  }
  const negative = balance < 0 ? ' data-balance-negative="true"' : '';
  return (
    `<span data-cell="balance"${negative}>` +
    `<span data-balance-value>${formatMinorUnits(balance, row.posting.currency)}</span>` +
    ` <span data-currency>${escapeHtml(row.posting.currency)}</span></span>`
  );
}
