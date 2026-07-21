import type {
  AmountFormat,
  BookPostingRef,
  MinorUnits,
  ReconciliationMatch,
  StatementLine,
} from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { renderAccountPathHTML } from '../utils/renderAccountPathHTML';

// Pure string builders + derivations for the Reconciliation component,
// shared verbatim by the client (innerHTML) and the SSR preload — the same
// contract as EntryRenderer/RegisterRenderer. No DOM APIs anywhere.

export interface ReconciliationRenderState {
  /** Canonical colon-delimited path of the account being reconciled. */
  account: string;
  /** Optional period caption shown next to the account, e.g. `Jul 2026`. */
  periodLabel?: string | null;
  lines: readonly StatementLine[];
  postings: readonly BookPostingRef[];
  matches: readonly ReconciliationMatch[];
  /**
   * Separator/grouping descriptor applied to every amount in the view
   * (header figures, statement and book cells, sum totals). Default
   * AMOUNT_FORMAT_COMMA_DOT — the original `1,234.56` bytes. Part of the
   * render state (not a side channel) so the SSR preload and the client
   * derive identical bytes from one plain-data object.
   */
  amountFormat?: AmountFormat;
}

export type ReconciliationRowType = 'pair' | 'statement-only' | 'book-only';

/**
 * One visual row of the split view: a matched pair (proposed or accepted),
 * a statement line with no active match, or a book posting with no active
 * match. Rejected matches dissolve back into the two unmatched row kinds.
 */
export interface ReconciliationRow {
  type: ReconciliationRowType;
  /** Sort key: statement date for pairs/lines, entry date for book rows. */
  date: string;
  line: StatementLine | null;
  /**
   * Book postings for the row: the match's group for pairs (one for 1:1
   * matches, several for sum matches), exactly one for book-only rows, and
   * null for statement-only rows.
   */
  postings: readonly BookPostingRef[] | null;
  match: ReconciliationMatch | null;
}

export interface ReconciliationTotals {
  /** Sum of all statement line amounts, per currency. */
  statement: Map<string, MinorUnits>;
  /** Sum of accepted matches' book posting amounts, per currency. */
  cleared: Map<string, MinorUnits>;
  /** statement − cleared, per currency (integer math throughout). */
  difference: Map<string, MinorUnits>;
}

const ROW_TYPE_RANK: Record<ReconciliationRowType, number> = {
  pair: 0,
  'statement-only': 1,
  'book-only': 2,
};

// Projects state into date-ordered visual rows. Matches with status
// `proposed`/`accepted` claim their line + posting as one pair row; rejected
// matches release both sides back into the unmatched pools so the pair
// visually dissolves.
export function computeReconciliationRows(
  state: ReconciliationRenderState
): ReconciliationRow[] {
  const activeByLineId = new Map<string, ReconciliationMatch>();
  const matchedPostingKeys = new Set<string>();
  for (const match of state.matches) {
    if (match.status === 'rejected') {
      continue;
    }
    activeByLineId.set(match.statementLineId, match);
    for (const posting of match.postings) {
      matchedPostingKeys.add(getPostingKey(posting));
    }
  }

  const rows: ReconciliationRow[] = [];
  for (const line of state.lines) {
    const match = activeByLineId.get(line.id);
    if (match != null) {
      rows.push({
        type: 'pair',
        date: line.date,
        line,
        postings: match.postings,
        match,
      });
    } else {
      rows.push({
        type: 'statement-only',
        date: line.date,
        line,
        postings: null,
        match: null,
      });
    }
  }
  for (const posting of state.postings) {
    if (matchedPostingKeys.has(getPostingKey(posting))) {
      continue;
    }
    rows.push({
      type: 'book-only',
      date: posting.entry.date,
      line: null,
      postings: [posting],
      match: null,
    });
  }

  // ISO dates compare correctly as strings; type rank then ids keep the
  // order fully deterministic when dates collide.
  rows.sort((a, b) => {
    const byDate = compareStrings(a.date, b.date);
    if (byDate !== 0) {
      return byDate;
    }
    const byType = ROW_TYPE_RANK[a.type] - ROW_TYPE_RANK[b.type];
    if (byType !== 0) {
      return byType;
    }
    return compareStrings(getRowIdentity(a), getRowIdentity(b));
  });
  return rows;
}

// Integer-only totals: statement closing balance, cleared (accepted) book
// balance, and their difference per currency. Zero difference in every
// currency is the reconciled state.
export function computeReconciliationTotals(
  state: ReconciliationRenderState
): ReconciliationTotals {
  const statement = new Map<string, MinorUnits>();
  for (const line of state.lines) {
    statement.set(
      line.currency,
      (statement.get(line.currency) ?? 0) + line.amount
    );
  }
  const cleared = new Map<string, MinorUnits>();
  for (const match of state.matches) {
    if (match.status !== 'accepted') {
      continue;
    }
    for (const ref of match.postings) {
      const posting = ref.entry.postings[ref.postingIndex];
      if (posting == null) {
        continue;
      }
      cleared.set(
        posting.currency,
        (cleared.get(posting.currency) ?? 0) + posting.amount
      );
    }
  }
  const difference = new Map<string, MinorUnits>();
  for (const [currency, total] of statement) {
    difference.set(currency, total - (cleared.get(currency) ?? 0));
  }
  for (const [currency, total] of cleared) {
    if (!difference.has(currency)) {
      difference.set(currency, -total);
    }
  }
  return { statement, cleared, difference };
}

/**
 * Stable identity for one visual row across state changes: the row type plus
 * the id of the data it presents (statement line id, or the first grouped
 * posting's entry:index key for book rows). The client component diffs
 * consecutive row projections with it to decide which rows LEAVE and which
 * ENTER on a verdict, driving the leave/enter animations. Deliberately not
 * baked into markup — renderer output bytes are unchanged — and the type is
 * part of the key on purpose: a pair dissolving into a statement-only row
 * for the same line is a removal plus an insertion, not a mutation.
 */
export function getReconciliationRowKey(row: ReconciliationRow): string {
  return `${row.type}:${getRowIdentity(row)}`;
}

// Full section HTML: sticky header with the three mono figures, then the
// two-column split body with a center action gutter.
export function renderReconciliationHTML(
  state: ReconciliationRenderState
): string {
  let html = '<section data-reconciliation>';
  html += renderReconciliationHeaderHTML(state);
  html += '<div data-reconciliation-body>';
  for (const [index, row] of computeReconciliationRows(state).entries()) {
    html += renderReconciliationRowHTML(row, index, state.amountFormat);
  }
  html += '</div></section>';
  return html;
}

export function renderReconciliationHeaderHTML(
  state: ReconciliationRenderState
): string {
  const { statement, cleared, difference } = computeReconciliationTotals(state);
  const balanced = isEveryAmountZero(difference);
  let html = '<header data-reconciliation-header data-sticky>';
  html += '<span data-recon-title>';
  html += `<span data-account>${renderAccountPathHTML(state.account)}</span>`;
  if (state.periodLabel != null && state.periodLabel !== '') {
    html += `<span data-recon-period>${escapeHtml(state.periodLabel)}</span>`;
  }
  html += '</span>';
  html += '<span data-recon-figures>';
  html += renderFigureHTML(
    'statement',
    'statement',
    statement,
    state.amountFormat
  );
  html += renderFigureHTML('cleared', 'cleared', cleared, state.amountFormat);
  html +=
    `<span data-recon-figure="difference" data-difference="${balanced ? 'zero' : 'nonzero'}">` +
    '<span data-figure-label>difference</span>' +
    (balanced ? '<span data-recon-dot aria-hidden="true">\u25cf</span>' : '') +
    `<span data-figure-value>${renderAmountListHTML(difference, state.amountFormat)}</span>` +
    '</span>';
  html += '</span></header>';
  return html;
}

// One split row. The row index and match/line ids are baked into data
// attributes so a single delegated click listener can resolve actions
// without per-row listeners.
export function renderReconciliationRowHTML(
  row: ReconciliationRow,
  index: number,
  amountFormat?: AmountFormat
): string {
  const attributes: string[] = [
    `data-recon-row`,
    `data-row-index="${index}"`,
    `data-row-type="${row.type}"`,
  ];
  if (row.match != null) {
    attributes.push(
      `data-match-id="${escapeHtml(row.match.id)}"`,
      `data-match-kind="${row.match.kind}"`,
      `data-match-status="${row.match.status}"`
    );
  }
  let html = `<div ${attributes.join(' ')}>`;
  html += renderStatementCellHTML(row, amountFormat);
  html += renderGutterHTML(row.match);
  html += renderBookCellHTML(row, amountFormat);
  html += '</div>';
  return html;
}

function renderStatementCellHTML(
  row: ReconciliationRow,
  amountFormat?: AmountFormat
): string {
  const { line } = row;
  if (line == null) {
    // Book-only rows leave a pinstriped statement cell with the
    // "outstanding" caption: the posting has not appeared on the bank side.
    return (
      '<div data-recon-cell="statement" data-recon-empty>' +
      '<span data-recon-outstanding>outstanding</span></div>'
    );
  }
  const direction = line.amount < 0 ? 'credit' : 'debit';
  return (
    `<div data-recon-cell="statement" data-amount="${direction}">` +
    `<span data-date>${escapeHtml(line.date)}</span>` +
    `<span data-description>${escapeHtml(line.description)}</span>` +
    renderCellAmountHTML(direction, line.amount, line.currency, amountFormat) +
    '</div>'
  );
}

function renderBookCellHTML(
  row: ReconciliationRow,
  amountFormat?: AmountFormat
): string {
  const refs = row.postings;
  if (refs == null || refs.length === 0) {
    // Statement-only rows: pinstriped book cell plus the create-entry
    // affordance. The component only emits a callback — it never writes
    // entries itself.
    const lineId = row.line != null ? escapeHtml(row.line.id) : '';
    return (
      '<div data-recon-cell="book" data-recon-empty>' +
      `<button type="button" data-recon-action="create-entry" data-line-id="${lineId}">create entry</button>` +
      '</div>'
    );
  }
  if (refs.length === 1) {
    return renderSingleBookCellHTML(refs[0], row.match, amountFormat);
  }
  return renderGroupedBookCellHTML(refs, row.match, amountFormat);
}

function renderSingleBookCellHTML(
  ref: BookPostingRef,
  match: ReconciliationMatch | null,
  amountFormat?: AmountFormat
): string {
  const posting = ref.entry.postings[ref.postingIndex];
  if (posting == null) {
    return '<div data-recon-cell="book" data-recon-empty></div>';
  }
  const direction = posting.amount < 0 ? 'credit' : 'debit';
  const description = ref.entry.payee ?? ref.entry.narration;
  let html = `<div data-recon-cell="book" data-amount="${direction}">`;
  html += `<span data-date>${escapeHtml(ref.entry.date)}</span>`;
  html += `<span data-description>${escapeHtml(description)}</span>`;
  if (match != null && match.kind === 'suggested') {
    html += `<span data-date-delta>${formatDateDelta(match.dateDelta)}</span>`;
  }
  if (match?.status === 'accepted') {
    html +=
      '<span data-flag-dot data-flag="cleared" aria-label="reconciled">\u25cf</span>';
  }
  html += renderCellAmountHTML(
    direction,
    posting.amount,
    posting.currency,
    amountFormat
  );
  html += '</div>';
  return html;
}

// Sum matches stack every grouped posting inside one book cell (subtle
// inner dividers), closed by a Σ total row that mirrors the statement
// amount — the visual proof the group covers the line.
function renderGroupedBookCellHTML(
  refs: readonly BookPostingRef[],
  match: ReconciliationMatch | null,
  amountFormat?: AmountFormat
): string {
  let total = 0;
  let currency = '';
  let html = '<div data-recon-cell="book" data-book-group>';
  for (const ref of refs) {
    const posting = ref.entry.postings[ref.postingIndex];
    if (posting == null) {
      continue;
    }
    total += posting.amount;
    currency = posting.currency;
    const direction = posting.amount < 0 ? 'credit' : 'debit';
    const description = ref.entry.payee ?? ref.entry.narration;
    html += `<span data-book-line data-amount="${direction}">`;
    html += `<span data-date>${escapeHtml(ref.entry.date)}</span>`;
    html += `<span data-description>${escapeHtml(description)}</span>`;
    html += renderCellAmountHTML(
      direction,
      posting.amount,
      posting.currency,
      amountFormat
    );
    html += '</span>';
  }
  const totalDirection = total < 0 ? 'credit' : 'debit';
  html += `<span data-book-sum data-amount="${totalDirection}">`;
  html += '<span data-sum-badge title="Sum of grouped postings">\u03a3</span>';
  if (match?.status === 'accepted') {
    html +=
      '<span data-flag-dot data-flag="cleared" aria-label="reconciled">\u25cf</span>';
  }
  html += renderCellAmountHTML(totalDirection, total, currency, amountFormat);
  html += '</span></div>';
  return html;
}

// Center gutter: hover-revealed action buttons. Proposed pairs get
// accept/reject; accepted pairs get undo;
// unmatched rows get an empty gutter (their affordances live in the cells).
function renderGutterHTML(match: ReconciliationMatch | null): string {
  let html = '<div data-recon-gutter>';
  if (match != null && match.status === 'proposed') {
    html +=
      `<button type="button" data-recon-action="accept" data-match-id="${escapeHtml(match.id)}" aria-label="Accept match" title="Accept match">\u2713</button>` +
      `<button type="button" data-recon-action="reject" data-match-id="${escapeHtml(match.id)}" aria-label="Reject match" title="Reject match">\u2717</button>`;
  } else if (match != null && match.status === 'accepted') {
    html += `<button type="button" data-recon-action="undo" data-match-id="${escapeHtml(match.id)}" aria-label="Undo match" title="Undo match">\u21a9</button>`;
  }
  html += '</div>';
  return html;
}

function renderCellAmountHTML(
  direction: 'debit' | 'credit',
  amount: MinorUnits,
  currency: string,
  amountFormat?: AmountFormat
): string {
  return (
    `<span data-cell="amount"><span data-amount-sign="${direction}" aria-hidden="true"></span>` +
    `<span data-amount-value>${formatMinorUnits(amount, currency, { sign: 'never', format: amountFormat })}</span>` +
    ` <span data-currency>${escapeHtml(currency)}</span></span>`
  );
}

// `+2d` / `−2d` mono hint for suggested matches (book date minus statement
// date). Uses the proper minus to match every other figure in the suite.
function formatDateDelta(dateDelta: number): string {
  const sign = dateDelta < 0 ? '\u2212' : '+';
  return `${sign}${Math.abs(dateDelta)}d`;
}

function renderFigureHTML(
  slot: string,
  label: string,
  amounts: Map<string, MinorUnits>,
  amountFormat?: AmountFormat
): string {
  return (
    `<span data-recon-figure="${slot}">` +
    `<span data-figure-label>${label}</span>` +
    `<span data-figure-value>${renderAmountListHTML(amounts, amountFormat)}</span></span>`
  );
}

// Header figures are per-currency; single-currency reconciliations (the
// norm) render one amount, multi-currency ones a short list.
function renderAmountListHTML(
  amounts: Map<string, MinorUnits>,
  amountFormat?: AmountFormat
): string {
  if (amounts.size === 0) {
    // The currencyless zero placeholder still honors the descriptor's
    // decimal separator (a `1.234,56` view must not show `0.00`).
    const decimal = amountFormat?.decimal ?? '.';
    return `<span data-figure-amount>0${decimal}00</span>`;
  }
  let html = '';
  for (const [currency, amount] of amounts) {
    html +=
      `<span data-figure-amount>${formatMinorUnits(amount, currency, { format: amountFormat })}` +
      ` <span data-currency>${escapeHtml(currency)}</span></span>`;
  }
  return html;
}

function isEveryAmountZero(amounts: Map<string, MinorUnits>): boolean {
  for (const amount of amounts.values()) {
    if (amount !== 0) {
      return false;
    }
  }
  return true;
}

function getPostingKey(ref: BookPostingRef): string {
  return `${ref.entry.id}:${ref.postingIndex}`;
}

function getRowIdentity(row: ReconciliationRow): string {
  if (row.line != null) {
    return `s-${row.line.id}`;
  }
  if (row.postings != null && row.postings.length > 0) {
    return `b-${getPostingKey(row.postings[0])}`;
  }
  return '';
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
