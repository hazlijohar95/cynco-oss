import { JOURNALS_TAG_NAME } from '../constants';
import { queueRender } from '../managers/UniversalRenderingManager';
import {
  type EntryRenderOptions,
  renderEntryHTML,
} from '../renderers/EntryRenderer';
import type { ColorScheme, LedgerEntry } from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { createLiveRegion, type LiveRegion } from '../utils/createLiveRegion';
import { escapeHtml } from '../utils/escapeHtml';
import { JournalsContainerLoaded } from './web-components';

export interface EntryStreamOptions extends EntryRenderOptions {
  /**
   * Source of entries. A ReadableStream is consumed through a reader (and
   * cancelled on cleanUp); any AsyncIterable works too (its `return()` is
   * invoked on cleanUp). The stream is consumed exactly once — construct a
   * new EntryStream for a new source.
   */
  stream: ReadableStream<LedgerEntry> | AsyncIterable<LedgerEntry>;
  /**
   * Expected total, shown as `n / total` in the sticky footer. Omit for an
   * open-ended feed (footer shows the running count alone).
   */
  total?: number;
  /**
   * Stick-to-bottom autoscroll (default true): the view follows appends
   * while the user is at (or near) the bottom, and stops following the
   * moment they scroll up — scrolling back to the bottom re-engages it.
   */
  autoScroll?: boolean;
  /** See the other components — pins light-dark() resolution on the host. */
  colorScheme?: ColorScheme;
  /** Fired per entry after it has been queued for render (0-based index). */
  onEntry?(entry: LedgerEntry, index: number): void;
  /** Fired when the stream closes; `count` is the number of entries seen. */
  onDone?(count: number): void;
}

export interface EntryStreamRenderProps {
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

// How close (px) to the bottom still counts as "at the bottom" for the
// autoscroll lock. One line-height of slack absorbs sub-pixel scroll math.
const STICK_TO_BOTTOM_SLACK = 20;

// The FileStream analog: renders journal entries as they arrive from a
// stream. Arrivals are buffered and flushed through the shared rAF queue —
// however many entries land within one frame, the DOM sees exactly one
// insertAdjacentHTML append (never more than one layout per frame). A sticky
// footer strip tracks the running count; autoscroll follows the feed unless
// the user has scrolled up.
export class EntryStream {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private scroller: HTMLElement | undefined;
  private entriesElement: HTMLElement | undefined;
  private countElement: HTMLElement | undefined;
  private stateElement: HTMLElement | undefined;
  /**
   * Polite live region announcing exactly TWO moments: stream start and
   * completion. The visual footer count updates every flush — dozens of
   * times per second on a fast feed — and announcing each tick would be an
   * unusable firehose, so the footer deliberately carries no aria-live (it
   * stays readable on demand via the virtual cursor) and only these two
   * discrete transitions reach the region. A stable sibling of the scroller
   * so appends never touch it.
   */
  private liveRegion: LiveRegion | undefined;

  private pendingEntries: LedgerEntry[] = [];
  private entryCount = 0;
  private done = false;
  private stickToBottom = true;
  private canceled = false;
  private cancelSource: (() => void) | undefined;

  constructor(
    public options: EntryStreamOptions,
    private isContainerManaged = false
  ) {}

  setOptions(options: EntryStreamOptions | undefined): void {
    if (options == null) return;
    // The stream itself is single-use and cannot be swapped after the fact;
    // only presentation options and callbacks are replaced.
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  render({ container, parentNode }: EntryStreamRenderProps = {}): void {
    container =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (parentNode != null && container.parentNode !== parentNode) {
      parentNode.appendChild(container);
    }
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    if (this.scroller == null || this.scroller.parentNode !== shadowRoot) {
      const scroller = document.createElement('div');
      scroller.setAttribute('data-scroller', '');
      scroller.setAttribute('data-entry-stream', '');
      scroller.innerHTML =
        '<div data-journals-content><div data-stream-entries></div></div>' +
        '<footer data-stream-footer>' +
        '<span data-stream-count>0</span>' +
        `${this.options.total != null ? `<span data-stream-total>/ ${escapeHtml(String(this.options.total))}</span>` : ''}` +
        '<span data-stream-state>streaming</span>' +
        '</footer>';
      shadowRoot.appendChild(scroller);
      this.scroller = scroller;
      this.entriesElement =
        scroller.querySelector('[data-stream-entries]') ?? undefined;
      this.countElement =
        scroller.querySelector('[data-stream-count]') ?? undefined;
      this.stateElement =
        scroller.querySelector('[data-stream-state]') ?? undefined;
      scroller.addEventListener('scroll', this.handleScroll, {
        passive: true,
      });
      // Created empty (SSR/hydration can never replay a stale message);
      // the start announcement lands on the next frame from startConsuming.
      this.liveRegion = createLiveRegion(shadowRoot);
      this.startConsuming();
    }
  }

  /** Number of entries received so far (rendered or pending this frame). */
  getEntryCount(): number {
    return this.entryCount;
  }

  isDone(): boolean {
    return this.done;
  }

  cleanUp(): void {
    this.canceled = true;
    this.cancelSource?.();
    this.cancelSource = undefined;
    this.pendingEntries.length = 0;
    if (this.scroller != null) {
      this.scroller.removeEventListener('scroll', this.handleScroll);
    }
    this.liveRegion?.cleanUp();
    this.liveRegion = undefined;
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.scroller = undefined;
    this.entriesElement = undefined;
    this.countElement = undefined;
    this.stateElement = undefined;
  }

  // Normalizes both source kinds to one pull loop. Each received entry is
  // buffered; the rAF-queued flush commits the whole buffer in one DOM
  // write. Reader errors that are not cancellation are surfaced to the
  // console but never thrown into the page.
  private startConsuming(): void {
    const { stream } = this.options;
    // Start announcement on the next frame, not synchronously: a live
    // region must exist in the accessibility tree BEFORE its content
    // changes for screen readers to voice the change.
    queueRender(() => {
      if (!this.canceled && !this.done) {
        this.liveRegion?.announce('Streaming entries\u2026');
      }
    });
    void (async () => {
      try {
        if (stream instanceof ReadableStream) {
          const reader = stream.getReader();
          this.cancelSource = () => {
            void reader.cancel().catch(() => {});
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (this.canceled) {
              return;
            }
            if (done) {
              break;
            }
            this.receiveEntry(value);
          }
        } else {
          const iterator = stream[Symbol.asyncIterator]();
          this.cancelSource = () => {
            void iterator.return?.().catch(() => {});
          };
          for (;;) {
            const { done, value } = await iterator.next();
            if (this.canceled) {
              return;
            }
            if (done === true) {
              break;
            }
            this.receiveEntry(value);
          }
        }
        this.done = true;
        queueRender(this.flush);
        // The second and last announcement: the final count, once. The
        // intermediate per-flush counts stay visual-only (see liveRegion).
        this.liveRegion?.announce(
          `${this.entryCount} ${this.entryCount === 1 ? 'entry' : 'entries'} loaded`
        );
        this.options.onDone?.(this.entryCount);
      } catch (error) {
        if (!this.canceled) {
          console.error('EntryStream: source failed', error);
        }
      }
    })();
  }

  private receiveEntry(entry: LedgerEntry): void {
    const index = this.entryCount;
    this.entryCount += 1;
    this.pendingEntries.push(entry);
    queueRender(this.flush);
    this.options.onEntry?.(entry, index);
  }

  // One flush per frame regardless of how many entries queued up: build one
  // HTML string, one insertAdjacentHTML, one footer text update, then (if
  // engaged) one scroll write.
  private flush = (): void => {
    const { entriesElement, scroller } = this;
    if (entriesElement == null || scroller == null) {
      return;
    }
    if (this.pendingEntries.length > 0) {
      let html = '';
      for (const entry of this.pendingEntries) {
        html += renderEntryHTML(entry, this.options);
      }
      this.pendingEntries.length = 0;
      entriesElement.insertAdjacentHTML('beforeend', html);
    }
    if (this.countElement != null) {
      this.countElement.textContent = `${this.entryCount}`;
    }
    if (this.done && this.stateElement != null) {
      this.stateElement.textContent = 'done';
      this.stateElement.setAttribute('data-stream-done', 'true');
    }
    if ((this.options.autoScroll ?? true) && this.stickToBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  };

  // The scroll-lock heuristic: any scroll position near the bottom keeps
  // (or re-engages) following; anything higher releases it. Uses the
  // bounding rect for the viewport height because jsdom reports
  // clientHeight as 0 (no layout).
  private handleScroll = (): void => {
    const { scroller } = this;
    if (scroller == null) {
      return;
    }
    const viewportHeight = scroller.getBoundingClientRect().height;
    this.stickToBottom =
      scroller.scrollTop + viewportHeight >=
      scroller.scrollHeight - STICK_TO_BOTTOM_SLACK;
  };
}
