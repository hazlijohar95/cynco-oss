import { JOURNALS_TAG_NAME } from '../constants';
import {
  type EntryRenderOptions,
  renderEntryHTML,
} from '../renderers/EntryRenderer';
import type { ColorScheme, LedgerEntry, Posting } from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { areEntriesEqual } from '../utils/areEntriesEqual';
import { warnIfInvalidEntryAmounts } from '../utils/minorUnitsBoundary';
import { JournalsContainerLoaded } from './web-components';

export interface JournalEntryOptions extends EntryRenderOptions {
  /**
   * Pins how `light-dark()` colors resolve. The stylesheet declares
   * `:host { color-scheme: light dark }`, which resolves from the USER's OS
   * preference — not the page's chosen theme — so sites with their own
   * light/dark toggle render the wrong mode unless they pin this. `light` /
   * `dark` apply an inline `color-scheme` on the host element (outer tree,
   * so it wins over `:host`); `system` (default) removes the pin and defers
   * to page CSS (e.g. `.dark journals-container { color-scheme: dark }`) or
   * the OS preference.
   */
  colorScheme?: ColorScheme;
  /**
   * Annotation slot hook, mirroring diff line-annotation slots: called once
   * per posting after every render. Return an element to have it appended in
   * a `[data-posting-annotation]` row directly below that posting, or null
   * to render nothing. The callback runs client-side only — SSR output never
   * includes annotations.
   */
  renderPostingAnnotation?(posting: Posting, index: number): HTMLElement | null;
}

export interface JournalEntryRenderProps {
  entry: LedgerEntry;
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
  /** Skips the entry-equality fast path and rebuilds the card. */
  forceRender?: boolean;
}

export interface JournalEntryHydrateProps {
  entry: LedgerEntry;
  /** Container whose (declarative) shadow root already holds SSR output. */
  container: HTMLElement;
}

// Renders a single LedgerEntry card into a <journals-container> shadow root.
// All markup comes from the shared EntryRenderer string builder, so client
// renders and SSR preloads are byte-identical; this class only manages DOM
// lifecycle, hydration adoption, and annotation slots.
export class JournalEntry {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private entryElement: HTMLElement | undefined;
  private annotationElements: HTMLElement[] = [];
  private renderedEntry: LedgerEntry | undefined;
  private renderedShowLineNumbers: boolean | undefined;
  /** Descriptor the current DOM was formatted with (reference compare): a
   * changed format must bust the entry-equality skip. */
  private renderedAmountFormat: JournalEntryOptions['amountFormat'];

  constructor(
    public options: JournalEntryOptions = {},
    private isContainerManaged = false
  ) {}

  setOptions(options: JournalEntryOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  // Adopts SSR output: when the shadow root already contains a rendered
  // [data-entry] card, take ownership of it without touching innerHTML so
  // hydration does zero DOM writes. Falls back to a full render when the
  // shadow root is empty or stale.
  hydrate({ entry, container }: JournalEntryHydrateProps): void {
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const existing = shadowRoot.querySelector('[data-entry]');
    if (existing instanceof HTMLElement) {
      // Hydration adoption ingests the entry without going through render's
      // boundary check, so it runs here too (the fallback below reaches it
      // via render). Same context, so at most one warning fires overall.
      warnIfInvalidEntryAmounts('JournalEntry', entry);
      this.entryElement = existing;
      this.renderedEntry = entry;
      this.renderedShowLineNumbers = this.options.showLineNumbers ?? false;
      this.renderedAmountFormat = this.options.amountFormat;
      this.renderAnnotations();
      return;
    }
    this.render({ entry, container });
  }

  render({
    entry,
    container,
    parentNode,
    forceRender = false,
  }: JournalEntryRenderProps): void {
    container = this.getOrCreateContainer(container, parentNode);
    applyHostColorScheme(container, this.options.colorScheme);
    const showLineNumbers = this.options.showLineNumbers ?? false;
    const canSkip =
      !forceRender &&
      this.entryElement != null &&
      this.renderedShowLineNumbers === showLineNumbers &&
      this.renderedAmountFormat === this.options.amountFormat &&
      areEntriesEqual(this.renderedEntry, entry);
    if (canSkip) {
      this.renderedEntry = entry;
      this.renderAnnotations();
      return;
    }
    // New entry data crossing the boundary (the canSkip fast path above
    // keeps unchanged re-renders out): a float posting amount would degrade
    // into truncated visual garbage; warn once, never throw, never touch
    // the rendered bytes.
    warnIfInvalidEntryAmounts('JournalEntry', entry);

    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // Parse the shared renderer's HTML through a detached element so the new
    // card can atomically replace the old one (SSR <style> siblings survive).
    const template = document.createElement('div');
    template.innerHTML = renderEntryHTML(entry, this.options);
    const nextEntryElement = template.firstElementChild;
    if (!(nextEntryElement instanceof HTMLElement)) {
      return;
    }
    this.removeAnnotations();
    if (this.entryElement != null && this.entryElement.parentNode != null) {
      this.entryElement.replaceWith(nextEntryElement);
    } else {
      shadowRoot.appendChild(nextEntryElement);
    }
    this.entryElement = nextEntryElement;
    this.renderedEntry = entry;
    this.renderedShowLineNumbers = showLineNumbers;
    this.renderedAmountFormat = this.options.amountFormat;
    this.renderAnnotations();
  }

  cleanUp(): void {
    this.removeAnnotations();
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.entryElement = undefined;
    this.renderedEntry = undefined;
    this.renderedShowLineNumbers = undefined;
    this.renderedAmountFormat = undefined;
  }

  private getOrCreateContainer(
    container: HTMLElement | undefined,
    parentNode: HTMLElement | undefined
  ): HTMLElement {
    const next =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (next !== this.container) {
      this.entryElement = undefined;
      this.renderedEntry = undefined;
    }
    this.container = next;
    if (parentNode != null && next.parentNode !== parentNode) {
      parentNode.appendChild(next);
    }
    return next;
  }

  // Rebuilds annotation slot rows below their postings. Annotations are
  // torn down and re-created on every render pass; entry cards are small
  // (a handful of postings) so caching buys nothing here.
  private renderAnnotations(): void {
    this.removeAnnotations();
    const { renderPostingAnnotation } = this.options;
    const { entryElement, renderedEntry } = this;
    if (
      renderPostingAnnotation == null ||
      entryElement == null ||
      renderedEntry == null
    ) {
      return;
    }
    const postingElements = entryElement.querySelectorAll('[data-posting]');
    for (const [index, posting] of renderedEntry.postings.entries()) {
      const postingElement = postingElements[index];
      if (!(postingElement instanceof HTMLElement)) {
        continue;
      }
      const content = renderPostingAnnotation(posting, index);
      if (content == null) {
        continue;
      }
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-posting-annotation', '');
      wrapper.setAttribute('data-posting-index', `${index}`);
      wrapper.appendChild(content);
      postingElement.after(wrapper);
      this.annotationElements.push(wrapper);
    }
  }

  private removeAnnotations(): void {
    for (const element of this.annotationElements) {
      element.remove();
    }
    this.annotationElements = [];
  }
}
