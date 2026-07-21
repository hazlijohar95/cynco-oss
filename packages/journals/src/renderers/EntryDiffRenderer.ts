import type {
  AmountFormat,
  EntryFieldDiff,
  EntryFlag,
  EntryListDiff,
  EntryVersionDiff,
  MinorUnits,
  PostingDiff,
  WordDiffSegment,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { renderAccountPathHTML } from '../utils/renderAccountPathHTML';
import { renderEntryFooterHTML, renderFlagDotHTML } from './EntryRenderer';

// Renders an EntryVersionDiff as a unified stacked card, visually consistent
// with the JournalEntry card: header field rows on top (old → new for
// changed fields, with word-level highlight spans), the aligned postings in
// the same grid vocabulary below, and — when the AFTER version is unbalanced
// — the exact imbalance footer JournalEntry would show. Removed material
// takes the ledger credit color family, added the debit family (reusing the
// existing --journals-debit/credit theme vars — no new theme tokens needed).
// Like every renderer here it is a pure string builder shared by client,
// SSR, and tests — no DOM APIs, every interpolation escaped.
export interface EntryDiffRenderOptions {
  /**
   * Separator/grouping descriptor applied to posting amounts and imbalance
   * figures (see {@link AmountFormat}). Default AMOUNT_FORMAT_COMMA_DOT —
   * the original `1,234.56` bytes. Plain data so SSR and client format from
   * the same descriptor; diff gutters and sign conventions are unaffected.
   */
  amountFormat?: AmountFormat;
}

export function renderEntryDiffHTML(
  diff: EntryVersionDiff,
  options: EntryDiffRenderOptions = {}
): string {
  const { amountFormat } = options;
  let html = `<article data-entry-diff data-diff-kind="${diff.kind}">`;
  html += renderDiffHeaderHTML(diff);
  html += '<div data-postings>';
  for (const [index, posting] of diff.postings.entries()) {
    html += renderPostingDiffHTML(posting, index, amountFormat);
  }
  html += '</div>';
  // Unbalanced AFTER versions get the standard imbalance footer; deleted
  // entries (after == null) have nothing left to balance.
  if (diff.after != null) {
    html += renderEntryFooterHTML(diff.after, amountFormat);
  }
  html += '</article>';
  return html;
}

// Header block: one row per field that has anything to show. Unchanged
// fields render their plain value (so the card still reads like an entry);
// changed fields render old → new.
function renderDiffHeaderHTML(diff: EntryVersionDiff): string {
  let html = '<header data-entry-diff-header>';
  html += renderScalarFieldHTML('date', diff.date, renderDateValueHTML);
  html += renderScalarFieldHTML('flag', diff.flag, renderFlagValueHTML);
  html += renderScalarFieldHTML('payee', diff.payee, renderPayeeValueHTML);
  html += renderScalarFieldHTML(
    'narration',
    diff.narration,
    renderNarrationValueHTML
  );
  html += renderListFieldHTML('tags', diff.tags, '#', 'data-tag');
  html += renderListFieldHTML('links', diff.links, '^', 'data-link');
  html += '</header>';
  return html;
}

type FieldValueRenderer = (
  value: string,
  segments: readonly WordDiffSegment[] | null
) => string;

// One scalar field row. Word-level segments (when present on a changed
// field) render changed runs inside [data-diff-word] spans; a null segment
// list on a changed field (length cap exceeded) highlights nothing at the
// word level — the old/new coloring already marks the whole field changed.
function renderScalarFieldHTML(
  name: string,
  field: EntryFieldDiff,
  renderValue: FieldValueRenderer
): string {
  if (field.kind === 'unchanged' && field.after == null) {
    // Absent on both sides: no row at all (mirrors EntryRenderer omitting
    // empty payee/narration so gap spacing stays even).
    return '';
  }
  let html = `<div data-diff-field="${name}" data-field-kind="${field.kind}">`;
  html += `<span data-field-label>${name}</span>`;
  if (field.kind === 'unchanged') {
    html += `<span data-field-value>${renderValue(field.after ?? '', null)}</span>`;
  } else {
    if (field.before != null) {
      html += `<span data-diff-old>${renderValue(field.before, field.beforeSegments)}</span>`;
    }
    if (field.before != null && field.after != null) {
      html += '<span data-diff-arrow aria-hidden="true">\u2192</span>';
    }
    if (field.after != null) {
      html += `<span data-diff-new>${renderValue(field.after, field.afterSegments)}</span>`;
    }
  }
  html += '</div>';
  return html;
}

function renderDateValueHTML(value: string): string {
  return `<span data-date>${escapeHtml(value)}</span>`;
}

// Flags render as the standard colored dot plus the flag word, so the diff
// stays legible without relying on color alone. Field diffs carry flags as
// plain strings; unknown values still render (uncolored dot), never throw.
function renderFlagValueHTML(value: string): string {
  return `${renderFlagDotHTML(value as EntryFlag)} ${escapeHtml(value)}`;
}

function renderPayeeValueHTML(
  value: string,
  segments: readonly WordDiffSegment[] | null
): string {
  return `<span data-payee>${renderSegmentsHTML(value, segments)}</span>`;
}

function renderNarrationValueHTML(
  value: string,
  segments: readonly WordDiffSegment[] | null
): string {
  return `<span data-narration>${renderSegmentsHTML(value, segments)}</span>`;
}

// Escaped text with changed runs wrapped in [data-diff-word] spans; falls
// back to the plain escaped value when no word-level data exists.
function renderSegmentsHTML(
  value: string,
  segments: readonly WordDiffSegment[] | null
): string {
  if (segments == null) {
    return escapeHtml(value);
  }
  let html = '';
  for (const segment of segments) {
    html += segment.changed
      ? `<span data-diff-word>${escapeHtml(segment.text)}</span>`
      : escapeHtml(segment.text);
  }
  return html;
}

// Tag/link pills with per-item add/remove classification.
function renderListFieldHTML(
  name: string,
  list: EntryListDiff,
  prefix: string,
  pillAttribute: string
): string {
  if (list.items.length === 0) {
    return '';
  }
  let html = `<div data-diff-field="${name}" data-field-kind="${list.kind}">`;
  html += `<span data-field-label>${name}</span>`;
  html += '<span data-field-value>';
  for (const item of list.items) {
    html +=
      `<span ${pillAttribute} data-diff-item="${item.kind}">` +
      `${prefix}${escapeHtml(item.value)}</span>`;
  }
  html += '</span></div>';
  return html;
}

// One aligned posting row in the JournalEntry grid vocabulary. Removed
// postings take the credit/deleted styling family, added the debit/added
// family (via [data-posting-diff]); amount-changed postings show the old
// amount struck through, then the new amount. The sign gutter and
// debit/credit color derive from the surviving amount (after side when it
// exists, before side for removed rows).
function renderPostingDiffHTML(
  posting: PostingDiff,
  index: number,
  amountFormat?: AmountFormat
): string {
  const amount = posting.afterAmount ?? posting.beforeAmount ?? 0;
  const direction = amount < 0 ? 'credit' : 'debit';
  let html =
    `<div data-posting data-posting-index="${index}"` +
    ` data-posting-diff="${posting.kind}" data-amount="${direction}">`;
  html += `<span data-cell="account">${renderAccountPathHTML(posting.account)}</span>`;
  html += `<span data-cell="sign" data-amount-sign="${direction}" aria-hidden="true"></span>`;
  html += '<span data-cell="amount">';
  if (posting.kind === 'amount-changed') {
    html +=
      `<span data-amount-old>${formatAmount(posting.beforeAmount, posting.currency, amountFormat)}</span>` +
      '<span data-diff-arrow aria-hidden="true">\u2192</span>';
  }
  html += `<span data-amount-value>${formatAmount(amount, posting.currency, amountFormat)}</span>`;
  html += '</span>';
  html += `<span data-cell="currency">${escapeHtml(posting.currency)}</span>`;
  html += '</div>';
  return html;
}

// Amounts render unsigned like JournalEntry postings — the sign gutter and
// color carry the semantics. Null (structurally impossible for the kinds
// that call this) degrades to 0 rather than throwing mid-render.
function formatAmount(
  amount: MinorUnits | null,
  currency: string,
  amountFormat?: AmountFormat
): string {
  return formatMinorUnits(amount ?? 0, currency, {
    sign: 'never',
    format: amountFormat,
  });
}
