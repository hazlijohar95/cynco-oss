import type { AmountFormat, LedgerEntry, Posting } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { getEntryImbalances } from '../utils/getEntryImbalances';
import { renderAccountPathHTML } from '../utils/renderAccountPathHTML';

export interface EntryRenderOptions {
  /**
   * Renders a 1-based posting number gutter column before the account path.
   * Defaults to false. The number column is part of the postings grid, so
   * toggling it changes the grid template (see `[data-line-numbers]` CSS).
   */
  showLineNumbers?: boolean;
  /**
   * Separator/grouping descriptor applied to posting amounts and imbalance
   * figures (see {@link AmountFormat}). Default AMOUNT_FORMAT_COMMA_DOT —
   * the original `1,234.56` bytes. Plain data so SSR and client format from
   * the same descriptor; sign gutters and U+2212 conventions are unaffected.
   */
  amountFormat?: AmountFormat;
}

// Renders a LedgerEntry card as an HTML string. This is the single renderer
// shared by the client (JournalEntry sets innerHTML from it) and the server
// (preloadJournalEntryHTML returns it inside a declarative shadow root), so
// SSR output and client output can never drift apart. It must therefore stay
// a pure string builder — no DOM APIs.
export function renderEntryHTML(
  entry: LedgerEntry,
  options: EntryRenderOptions = {}
): string {
  const { showLineNumbers = false, amountFormat } = options;
  const lineNumbersAttribute = showLineNumbers ? ' data-line-numbers' : '';
  let html =
    `<article data-entry data-entry-id="${escapeHtml(entry.id)}"` +
    ` data-flag="${escapeHtml(entry.flag)}"${lineNumbersAttribute}>`;
  html += renderEntryHeaderHTML(entry);
  html += '<div data-postings>';
  for (const [index, posting] of entry.postings.entries()) {
    html += renderPostingHTML(posting, index, showLineNumbers, amountFormat);
  }
  html += '</div>';
  html += renderEntryFooterHTML(entry, amountFormat);
  html += '</article>';
  return html;
}

// Header row: date, flag dot, payee, narration, then #tag pills and ^links.
// Absent payee and empty narration are omitted entirely (no empty spans) so
// CSS gap spacing stays even.
function renderEntryHeaderHTML(entry: LedgerEntry): string {
  let html = '<header data-entry-header>';
  html += `<span data-date>${escapeHtml(entry.date)}</span>`;
  html += renderFlagDotHTML(entry.flag);
  if (entry.payee != null && entry.payee !== '') {
    html += `<span data-payee>${escapeHtml(entry.payee)}</span>`;
  }
  if (entry.narration !== '') {
    html += `<span data-narration>${escapeHtml(entry.narration)}</span>`;
  }
  for (const tag of entry.tags) {
    html += `<span data-tag>#${escapeHtml(tag)}</span>`;
  }
  for (const link of entry.links) {
    html += `<span data-link>^${escapeHtml(link)}</span>`;
  }
  html += '</header>';
  return html;
}

// The flag is a colored dot (not an emoji glyph): a single ● whose color is
// driven purely by the [data-flag] attribute in CSS, keeping the markup
// identical across flags. `flag` is typed as an EntryFlag union, but this
// renderer is also reachable from untyped JS hosts and from diff data whose
// before/after values are arbitrary strings, so the value is escaped before
// it lands in three attributes — matching the escaping discipline every other
// field in this renderer already follows. Unknown flags still render (the CSS
// simply has no color rule for them).
export function renderFlagDotHTML(flag: LedgerEntry['flag']): string {
  const escaped = escapeHtml(flag);
  return `<span data-flag-dot data-flag="${escaped}" title="${escaped}" aria-label="${escaped}">\u25cf</span>`;
}

// One posting row in the entry grid: optional number gutter, account path,
// +/− sign gutter, right-aligned amount, currency code. The amount value is
// rendered unsigned — the sign gutter and debit/credit color carry the
// semantics, mirroring how diff gutters carry +/-.
function renderPostingHTML(
  posting: Posting,
  index: number,
  showLineNumbers: boolean,
  amountFormat?: AmountFormat
): string {
  const direction = posting.amount < 0 ? 'credit' : 'debit';
  let html =
    `<div data-posting data-posting-index="${index}"` +
    ` data-amount="${direction}">`;
  if (showLineNumbers) {
    html += `<span data-cell="number">${index + 1}</span>`;
  }
  html += `<span data-cell="account">${renderAccountPathHTML(posting.account)}</span>`;
  html += `<span data-cell="sign" data-amount-sign="${direction}" aria-hidden="true"></span>`;
  html +=
    '<span data-cell="amount"><span data-amount-value>' +
    `${formatMinorUnits(posting.amount, posting.currency, { sign: 'never', format: amountFormat })}` +
    '</span></span>';
  html += `<span data-cell="currency">${escapeHtml(posting.currency)}</span>`;
  html += '</div>';
  return html;
}

// Balanced entries get no footer at all. Unbalanced entries get one row per
// offending currency: the checker-gradient bar plus the signed imbalance in
// danger color. Rendering (not repairing) bad data is deliberate — the data
// layer owns correctness, the renderer owns visibility. Exported so
// EntryDiffRenderer can give an unbalanced AFTER version the identical
// treatment.
export function renderEntryFooterHTML(
  entry: LedgerEntry,
  amountFormat?: AmountFormat
): string {
  const imbalances = getEntryImbalances(entry);
  if (imbalances.size === 0) {
    return '';
  }
  let html = '<footer data-entry-footer>';
  for (const [currency, amount] of imbalances) {
    html += `<div data-imbalance data-currency="${escapeHtml(currency)}">`;
    html += '<span data-imbalance-bar aria-hidden="true"></span>';
    html +=
      '<span data-imbalance-amount>' +
      `${formatMinorUnits(amount, currency, { sign: 'always', format: amountFormat })} ${escapeHtml(currency)}` +
      '</span>';
    html += '</div>';
  }
  html += '</footer>';
  return html;
}
