import { JOURNALS_TAG_NAME } from '../constants';
import {
  computeReconciliationTotals,
  type ReconciliationRenderState,
  renderReconciliationHTML,
} from '../renderers/ReconciliationRenderer';
import type {
  BookPostingRef,
  ColorScheme,
  MinorUnits,
  ReconciliationMatch,
  StatementLine,
} from '../types';
import { applyHostColorScheme } from '../utils/applyHostColorScheme';
import { proposeMatches } from '../utils/proposeMatches';
import { JournalsContainerLoaded } from './web-components';

export interface ReconciliationOptions {
  /** Canonical colon-delimited path of the account being reconciled. */
  account: string;
  /** Optional period caption shown next to the account, e.g. `Jul 2026`. */
  periodLabel?: string;
  statementLines: readonly StatementLine[];
  postings: readonly BookPostingRef[];
  /**
   * Initial match set. Defaults to `proposeMatches(statementLines,
   * postings)`. Pass your own list (kind `manual` allowed) to seed a saved
   * session; statuses are respected as given.
   */
  matches?: readonly ReconciliationMatch[];
  /** Suggestion window forwarded to the default `proposeMatches`. Default 3. */
  dateWindowDays?: number;
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
  /** Fired after a match flips to `accepted` (via button or `acceptMatch`). */
  onAccept?(match: ReconciliationMatch): void;
  /** Fired after a match flips to `rejected`; the pair dissolves visually. */
  onReject?(match: ReconciliationMatch): void;
  /** Fired after an accepted/rejected match returns to `proposed`. */
  onUndo?(match: ReconciliationMatch): void;
  /**
   * Fired when the "create entry" affordance on an unmatched statement line
   * is clicked. The component never creates entries itself — that is the
   * caller's (and the data layer's) job.
   */
  onCreateEntry?(line: StatementLine): void;
}

export interface ReconciliationRenderProps {
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

export interface ReconciliationHydrateProps {
  /** Container whose (declarative) shadow root already holds SSR output. */
  container: HTMLElement;
}

export interface ReconciliationState {
  matches: readonly ReconciliationMatch[];
  /** statement total − accepted book total, per currency (integer math). */
  difference: Map<string, MinorUnits>;
}

// The accounting analog of a merge-conflict resolver: statement lines on the
// left, book postings on the right, proposed matches as tinted pairs with
// accept/reject in a center gutter. All markup comes from the shared
// ReconciliationRenderer string builder (SSR shares it verbatim); this class
// owns match state, event delegation, and DOM lifecycle. Every figure is
// integer minor-unit math — floats never touch amounts.
export class Reconciliation {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private section: HTMLElement | undefined;
  private matches: ReconciliationMatch[];
  private lastLines: readonly StatementLine[];
  private lastPostings: readonly BookPostingRef[];

  constructor(
    public options: ReconciliationOptions,
    private isContainerManaged = false
  ) {
    this.lastLines = options.statementLines;
    this.lastPostings = options.postings;
    this.matches = initializeMatches(options);
  }

  // Replaces options. New statement/posting/match data (by reference)
  // re-derives the match set; callback- or label-only changes keep the
  // in-flight accept/reject state untouched.
  setOptions(options: ReconciliationOptions | undefined): void {
    if (options == null) return;
    const dataChanged =
      options.statementLines !== this.lastLines ||
      options.postings !== this.lastPostings ||
      options.matches != null;
    this.options = options;
    if (this.container != null) {
      applyHostColorScheme(this.container, options.colorScheme);
    }
    if (dataChanged) {
      this.lastLines = options.statementLines;
      this.lastPostings = options.postings;
      this.matches = initializeMatches(options);
      this.rerender();
    }
  }

  render({ container, parentNode }: ReconciliationRenderProps = {}): void {
    container =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (parentNode != null && container.parentNode !== parentNode) {
      parentNode.appendChild(container);
    }
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    if (this.section == null || this.section.parentNode !== shadowRoot) {
      const template = document.createElement('div');
      template.innerHTML = renderReconciliationHTML(this.getRenderState());
      const section = template.firstElementChild;
      if (!(section instanceof HTMLElement)) {
        return;
      }
      shadowRoot.appendChild(section);
      this.adoptSection(section);
    } else {
      this.rerender();
    }
  }

  // Adopts SSR output: the pre-rendered [data-reconciliation] section is
  // taken over in place (zero DOM writes) and only replaced when match state
  // actually changes.
  hydrate({ container }: ReconciliationHydrateProps): void {
    this.container = container;
    applyHostColorScheme(container, this.options.colorScheme);
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const section = shadowRoot.querySelector('[data-reconciliation]');
    if (!(section instanceof HTMLElement)) {
      this.render({ container });
      return;
    }
    this.adoptSection(section);
  }

  acceptMatch(id: string): void {
    this.transitionMatch(id, 'accepted', this.options.onAccept);
  }

  rejectMatch(id: string): void {
    this.transitionMatch(id, 'rejected', this.options.onReject);
  }

  undoMatch(id: string): void {
    this.transitionMatch(id, 'proposed', this.options.onUndo);
  }

  getState(): ReconciliationState {
    const { difference } = computeReconciliationTotals(this.getRenderState());
    return { matches: this.matches, difference };
  }

  cleanUp(): void {
    this.section?.removeEventListener('click', this.handleClick);
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.section = undefined;
  }

  private adoptSection(section: HTMLElement): void {
    this.section?.removeEventListener('click', this.handleClick);
    this.section = section;
    // One delegated listener resolves every gutter/cell action from data
    // attributes — button lifetime stays independent of row re-renders.
    section.addEventListener('click', this.handleClick);
  }

  private getRenderState(): ReconciliationRenderState {
    return {
      account: this.options.account,
      periodLabel: this.options.periodLabel ?? null,
      lines: this.options.statementLines,
      postings: this.options.postings,
      matches: this.matches,
    };
  }

  // Match sets are small (a statement page), so state changes re-render the
  // whole section in one innerHTML write — the same wholesale-window
  // strategy the Register uses, without the virtualization.
  private rerender(): void {
    if (this.section == null) {
      return;
    }
    const template = document.createElement('div');
    template.innerHTML = renderReconciliationHTML(this.getRenderState());
    const next = template.firstElementChild;
    if (!(next instanceof HTMLElement)) {
      return;
    }
    this.section.replaceWith(next);
    this.adoptSection(next);
  }

  private transitionMatch(
    id: string,
    status: ReconciliationMatch['status'],
    callback: ((match: ReconciliationMatch) => void) | undefined
  ): void {
    const index = this.matches.findIndex((match) => match.id === id);
    const current = this.matches[index];
    if (current == null || current.status === status) {
      return;
    }
    // Matches are replaced immutably so callers can hold getState()
    // snapshots without seeing them mutate underneath.
    const next: ReconciliationMatch = { ...current, status };
    this.matches = [
      ...this.matches.slice(0, index),
      next,
      ...this.matches.slice(index + 1),
    ];
    this.rerender();
    callback?.(next);
  }

  private handleClick = (event: Event): void => {
    const { target } = event;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('[data-recon-action]');
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const action = button.getAttribute('data-recon-action');
    if (action === 'create-entry') {
      const lineId = button.getAttribute('data-line-id');
      const line = this.options.statementLines.find(
        (candidate) => candidate.id === lineId
      );
      if (line != null) {
        this.options.onCreateEntry?.(line);
      }
      return;
    }
    const matchId = button.getAttribute('data-match-id');
    if (matchId == null) {
      return;
    }
    if (action === 'accept') {
      this.acceptMatch(matchId);
    } else if (action === 'reject') {
      this.rejectMatch(matchId);
    } else if (action === 'undo') {
      this.undoMatch(matchId);
    }
  };
}

// Seed matches from options: an explicit list wins (statuses respected),
// otherwise run the deterministic proposal engine over the provided data.
function initializeMatches(
  options: ReconciliationOptions
): ReconciliationMatch[] {
  if (options.matches != null) {
    return [...options.matches];
  }
  return proposeMatches(options.statementLines, options.postings, {
    dateWindowDays: options.dateWindowDays,
  });
}
