import { STATEMENTS_TAG_NAME } from '../constants';
import { renderIncomeStatementHTML } from '../renderers/IncomeStatementRenderer';
import type { ColorScheme, IncomeStatementData } from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { StatementsContainerLoaded } from './web-components';

// Named IncomeStatementViewOptions (not IncomeStatementOptions) because this
// package re-exports the engine's IncomeStatementOptions — the options bag
// of deriveIncomeStatement — and the two must not collide in the public
// surface.
export interface IncomeStatementViewOptions {
  /**
   * Pins how `light-dark()` colors resolve; see TrialBalanceViewOptions for
   * the user-preference pitfall this exists to solve.
   */
  colorScheme?: ColorScheme;
}

export interface IncomeStatementRenderProps {
  data: IncomeStatementData;
  /** Existing `<statements-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
  /** Skips the data-reference fast path and rebuilds the tables. */
  forceRender?: boolean;
}

// Renders a derived IncomeStatementData into a <statements-container>
// shadow root. All markup comes from the shared IncomeStatementRenderer
// string builder (client output and any future SSR preload stay
// byte-identical); this class only manages DOM lifecycle. Derivations
// return a fresh immutable object per call, so the re-render fast path
// compares the data by reference instead of deep-walking every line.
export class IncomeStatement {
  static LoadedCustomComponent: boolean = StatementsContainerLoaded;

  private container: HTMLElement | undefined;
  private rootElement: HTMLElement | undefined;
  private renderedData: IncomeStatementData | undefined;

  constructor(
    public options: IncomeStatementViewOptions = {},
    private isContainerManaged = false
  ) {}

  setOptions(options: IncomeStatementViewOptions | undefined): void {
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
  }: IncomeStatementRenderProps): void {
    container = this.getOrCreateContainer(container, parentNode);
    applyHostColorScheme(container, this.options.colorScheme);
    const canSkip =
      !forceRender && this.rootElement != null && this.renderedData === data;
    if (canSkip) {
      return;
    }

    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // Parse the shared renderer's HTML through a detached element so the new
    // tables can atomically replace the old ones (any <style> siblings a
    // host injected into the shadow root survive).
    const template = document.createElement('div');
    template.innerHTML = renderIncomeStatementHTML(data);
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
  }

  cleanUp(): void {
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.rootElement = undefined;
    this.renderedData = undefined;
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
    }
    this.container = next;
    if (parentNode != null && next.parentNode !== parentNode) {
      parentNode.appendChild(next);
    }
    return next;
  }
}
