import { JOURNALS_TAG_NAME } from '../constants';
import { renderEntryDiffHTML } from '../renderers/EntryDiffRenderer';
import type { ColorScheme, LedgerEntry } from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { areEntryDiffInputsEqual } from '../utils/areEntryDiffInputsEqual';
import { diffEntryVersions } from '../utils/diffEntryVersions';
import { JournalsContainerLoaded } from './web-components';

export interface EntryDiffOptions {
  /**
   * Pins how `light-dark()` colors resolve. The stylesheet declares
   * `:host { color-scheme: light dark }`, which resolves from the USER's OS
   * preference — not the page's chosen theme — so sites with their own
   * light/dark toggle render the wrong mode unless they pin this. `light` /
   * `dark` apply an inline `color-scheme` on the host element (outer tree,
   * so it wins over `:host`); `system` (default) removes the pin and defers
   * to page CSS or the OS preference.
   */
  colorScheme?: ColorScheme;
}

export interface EntryDiffRenderProps {
  /** Old version; null models entry creation (everything added). */
  before: LedgerEntry | null;
  /** New version; null models deletion/void (everything removed). */
  after: LedgerEntry | null;
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
  /** Skips the input-equality fast path and rebuilds the card. */
  forceRender?: boolean;
}

export interface EntryDiffHydrateProps {
  before: LedgerEntry | null;
  after: LedgerEntry | null;
  /** Container whose (declarative) shadow root already holds SSR output. */
  container: HTMLElement;
}

// Renders the diff between two versions of a journal entry into a
// <journals-container> shadow root — the audit-trail view. Same lifecycle
// shape as JournalEntry (render / hydrate / cleanUp, structural-equality
// fast path via areEntryDiffInputsEqual); all markup comes from the shared
// EntryDiffRenderer string builder so client renders and SSR preloads are
// byte-identical. Posting annotation slots are intentionally NOT supported
// in v1 — the diff card is a read-only audit artifact; annotations stay a
// JournalEntry feature until a concrete need appears.
export class EntryDiff {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private diffElement: HTMLElement | undefined;
  private renderedBefore: LedgerEntry | null = null;
  private renderedAfter: LedgerEntry | null = null;
  private hasRendered = false;

  constructor(
    public options: EntryDiffOptions = {},
    private isContainerManaged = false
  ) {}

  setOptions(options: EntryDiffOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  // Adopts SSR output: when the shadow root already contains a rendered
  // [data-entry-diff] card, take ownership of it without touching innerHTML
  // so hydration does zero DOM writes. Falls back to a full render when the
  // shadow root is empty or stale.
  hydrate({ before, after, container }: EntryDiffHydrateProps): void {
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const existing = shadowRoot.querySelector('[data-entry-diff]');
    if (existing instanceof HTMLElement) {
      this.diffElement = existing;
      this.renderedBefore = before;
      this.renderedAfter = after;
      this.hasRendered = true;
      return;
    }
    this.render({ before, after, container });
  }

  render({
    before,
    after,
    container,
    parentNode,
    forceRender = false,
  }: EntryDiffRenderProps): void {
    container = this.getOrCreateContainer(container, parentNode);
    applyHostColorScheme(container, this.options.colorScheme);
    const canSkip =
      !forceRender &&
      this.hasRendered &&
      this.diffElement != null &&
      areEntryDiffInputsEqual(
        this.renderedBefore,
        this.renderedAfter,
        before,
        after
      );
    if (canSkip) {
      this.renderedBefore = before;
      this.renderedAfter = after;
      return;
    }

    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // Parse the shared renderer's HTML through a detached element so the new
    // card can atomically replace the old one (SSR <style> siblings survive).
    const template = document.createElement('div');
    template.innerHTML = renderEntryDiffHTML(diffEntryVersions(before, after));
    const nextDiffElement = template.firstElementChild;
    if (!(nextDiffElement instanceof HTMLElement)) {
      return;
    }
    if (this.diffElement != null && this.diffElement.parentNode != null) {
      this.diffElement.replaceWith(nextDiffElement);
    } else {
      shadowRoot.appendChild(nextDiffElement);
    }
    this.diffElement = nextDiffElement;
    this.renderedBefore = before;
    this.renderedAfter = after;
    this.hasRendered = true;
  }

  cleanUp(): void {
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.diffElement = undefined;
    this.renderedBefore = null;
    this.renderedAfter = null;
    this.hasRendered = false;
  }

  private getOrCreateContainer(
    container: HTMLElement | undefined,
    parentNode: HTMLElement | undefined
  ): HTMLElement {
    const next =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (next !== this.container) {
      this.diffElement = undefined;
      this.renderedBefore = null;
      this.renderedAfter = null;
      this.hasRendered = false;
    }
    this.container = next;
    if (parentNode != null && next.parentNode !== parentNode) {
      parentNode.appendChild(next);
    }
    return next;
  }
}
