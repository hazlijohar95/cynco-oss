import { escapeHtml } from './escapeHtml';

// Renders a canonical colon-delimited account path as HTML, wrapping each
// separator so CSS can give the `:` glyphs punctuation color while segments
// keep the account color. Splitting on ':' is safe because canonical paths
// forbid empty segments; malformed paths still render legibly (graceful
// degradation) since empty splits produce empty segment spans, not errors.
export function renderAccountPathHTML(account: string): string {
  const segments = account.split(':');
  let html = '';
  for (let i = 0; i < segments.length; i += 1) {
    if (i > 0) {
      html += '<span data-account-separator>:</span>';
    }
    html += `<span data-account-segment>${escapeHtml(segments[i])}</span>`;
  }
  return html;
}
