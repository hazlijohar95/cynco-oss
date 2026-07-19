import { renderEntryDiffHTML } from '../renderers/EntryDiffRenderer';
import styles from '../style.css?inline';
import type { LedgerEntry } from '../types';
import { diffEntryVersions } from '../utils/diffEntryVersions';

// Produces the shadow-root HTML for one entry diff card, ready to be
// embedded in a declarative shadow DOM template (mirrors
// preloadJournalEntryHTML). The same diffEntryVersions + EntryDiffRenderer
// pipeline powers the client render, so hydration can adopt this DOM
// verbatim. The component stylesheet is inlined because adoptedStyleSheets
// cannot be expressed in serialized HTML. Async to keep the signature stable
// if theme resolution ever becomes asynchronous.
export function preloadEntryDiffHTML(
  before: LedgerEntry | null,
  after: LedgerEntry | null
): Promise<string> {
  return Promise.resolve(
    `<style>${styles}</style>${renderEntryDiffHTML(diffEntryVersions(before, after))}`
  );
}
