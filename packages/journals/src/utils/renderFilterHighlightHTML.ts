import { escapeHtml } from './escapeHtml';

// Escapes `text` for HTML while wrapping every case-insensitive occurrence
// of `lowerQuery` (an already-lowercased, non-empty needle) in
// `<mark data-filter-match>`. Escape-safety approach: match positions are
// found on the RAW string (via its lowercase copy), then the three slices —
// before / match / after — are escaped SEPARATELY and joined with the mark
// tags. We never run a regex or substring search over escaped HTML, so a
// query like `amp` can never split an `&amp;` entity and user text can never
// smuggle markup around the marks. Occurrences are non-overlapping,
// scanning left to right (the standard indexOf walk).
export function renderFilterHighlightHTML(
  text: string,
  lowerQuery: string
): string {
  if (lowerQuery === '' || text === '') {
    return escapeHtml(text);
  }
  const lowerText = text.toLowerCase();
  let position = lowerText.indexOf(lowerQuery);
  if (position < 0) {
    return escapeHtml(text);
  }
  let html = '';
  let sliceStart = 0;
  while (position >= 0) {
    html +=
      escapeHtml(text.slice(sliceStart, position)) +
      '<mark data-filter-match>' +
      escapeHtml(text.slice(position, position + lowerQuery.length)) +
      '</mark>';
    sliceStart = position + lowerQuery.length;
    position = lowerText.indexOf(lowerQuery, sliceStart);
  }
  html += escapeHtml(text.slice(sliceStart));
  return html;
}
