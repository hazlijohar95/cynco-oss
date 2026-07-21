import { STATEMENTS_TAG_NAME } from '../constants';
import {
  renderTrialBalanceHTML,
  type TrialBalanceRenderOptions,
} from '../renderers/TrialBalanceRenderer';
import type { ColorScheme, TrialBalanceData } from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { StatementsContainerLoaded } from './web-components';

// Named TrialBalanceViewOptions (not TrialBalanceOptions) because this
// package re-exports the engine's TrialBalanceOptions — the options bag of
// deriveTrialBalance — and the two must not collide in the public surface.
export interface TrialBalanceViewOptions extends TrialBalanceRenderOptions {
  /**
   * Pins how `light-dark()` colors resolve. The stylesheet declares
   * `:host { color-scheme: light dark }`, which resolves from the USER's OS
   * preference — not the page's chosen theme — so sites with their own
   * light/dark toggle render the wrong mode unless they pin this. `light` /
   * `dark` apply an inline `color-scheme` on the host element (outer tree,
   * so it wins over `:host`); `system` (default) removes the pin and defers
   * to page CSS (e.g. `.dark statements-container { color-scheme: dark }`)
   * or the OS preference.
   */
  colorScheme?: ColorScheme;
}

export interface TrialBalanceRenderProps {
  data: TrialBalanceData;
  /** Existing `<statements-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
  /** Skips the data-reference fast path and rebuilds the tables. */
  forceRender?: boolean;
}

// Renders a derived TrialBalanceData into a <statements-container> shadow
// root. All markup comes from the shared TrialBalanceRenderer string
// builder, so any future SSR preload stays byte-identical with client
// renders; this class only manages DOM lifecycle. Derivations return a fresh
// immutable object per call, so the re-render fast path compares the data by
// reference (plus render-shaping options) instead of deep-walking every row.
export class TrialBalance {
  static LoadedCustomComponent: boolean = StatementsContainerLoaded;

  private container: HTMLElement | undefined;
  private rootElement: HTMLElement | undefined;
  private renderedData: TrialBalanceData | undefined;
  private renderedShowClassification: boolean | undefined;
  /** Descriptor the current DOM was formatted with (reference compare): a
   * changed format must bust the data-reference skip. */
  private renderedAmountFormat: TrialBalanceViewOptions['amountFormat'];

  constructor(
    public options: TrialBalanceViewOptions = {},
    private isContainerManaged = false
  ) {}

  setOptions(options: TrialBalanceViewOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
  }

  render({
    data,
    container,
    parentNode,
    forceRender = false,
  }: TrialBalanceRenderProps): void {
    container = this.getOrCreateContainer(container, parentNode);
    applyHostColorScheme(container, this.options.colorScheme);
    const showClassification = this.options.showClassification ?? false;
    const canSkip =
      !forceRender &&
      this.rootElement != null &&
      this.renderedShowClassification === showClassification &&
      this.renderedAmountFormat === this.options.amountFormat &&
      this.renderedData === data;
    if (canSkip) {
      return;
    }

    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // Parse the shared renderer's HTML through a detached element so the new
    // tables can atomically replace the old ones (any <style> siblings a
    // host injected into the shadow root survive).
    const template = document.createElement('div');
    template.innerHTML = renderTrialBalanceHTML(data, this.options);
    const nextRootElement = template.firstElementChild;
    if (!(nextRootElement instanceof HTMLElement)) {
      return;
    }
    if (this.rootElement != null && this.rootElement.parentNode != null) {
      this.rootElement.replaceWith(nextRootElement);
    } else {
      shadowRoot.appendChild(nextRootElement);
    }
    this.rootElement = nextRootElement;
    this.renderedData = data;
    this.renderedShowClassification = showClassification;
    this.renderedAmountFormat = this.options.amountFormat;
  }

  cleanUp(): void {
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.rootElement = undefined;
    this.renderedData = undefined;
    this.renderedShowClassification = undefined;
    this.renderedAmountFormat = undefined;
  }

  private getOrCreateContainer(
    container: HTMLElement | undefined,
    parentNode: HTMLElement | undefined
  ): HTMLElement {
    const next =
      container ??
      this.container ??
      document.createElement(STATEMENTS_TAG_NAME);
    if (next !== this.container) {
      this.rootElement = undefined;
      this.renderedData = undefined;
      this.renderedAmountFormat = undefined;
    }
    this.container = next;
    if (parentNode != null && next.parentNode !== parentNode) {
      parentNode.appendChild(next);
    }
    return next;
  }
}
