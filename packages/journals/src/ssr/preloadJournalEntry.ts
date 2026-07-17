import {
  type EntryRenderOptions,
  renderEntryHTML,
} from '../renderers/EntryRenderer';
import styles from '../style.css?inline';
import type { LedgerEntry } from '../types';

export interface PreloadJournalEntryOptions extends EntryRenderOptions {}

// Produces the shadow-root HTML for one entry card, ready to be embedded in
// a declarative shadow DOM template (see react templateRender). The same
// EntryRenderer string builder powers the client render, so hydration can
// adopt this DOM verbatim. The component stylesheet is inlined because
// adoptedStyleSheets cannot be expressed in serialized HTML. Async to keep
// the signature stable if theme resolution ever becomes asynchronous.
export function preloadJournalEntryHTML(
  entry: LedgerEntry,
  options?: PreloadJournalEntryOptions
): Promise<string> {
  return Promise.resolve(
    `<style>${styles}</style>${renderEntryHTML(entry, options)}`
  );
}
