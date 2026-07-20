import { JOURNALS_TAG_NAME } from '../constants';
import { queueRender } from '../managers/UniversalRenderingManager';
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
import { createLiveRegion, type LiveRegion } from '../utils/createLiveRegion';
import { formatMinorUnits } from '../utils/formatMinorUnits';
import { proposeMatches } from '../utils/proposeMatches';
import type { WorkerPoolManager } from '../worker/WorkerPoolManager';
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
   * Sum-pass group cap forwarded to the default `proposeMatches`. Default 3;
   * pass 1 to disable sum matching.
   */
  maxGroupSize?: number;
  /**
   * Optional worker pool: match proposals are computed off the main thread
   * and applied on the next animation frame after they resolve (the view
   * renders unmatched until then). Without a pool — or once it reports
   * failure — proposals are computed inline, unchanged. The engine is
   * deterministic, so both paths produce the identical match set.
   */
  workerPool?: WorkerPoolManager;
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
   * Opts out of the built-in screen-reader announcements. By default every
   * accept / reject / undo announces the resulting per-currency difference
   * (or "All currencies reconciled") through a visually-hidden polite live
   * region — the header's difference figures change silently otherwise.
   * Hosts that narrate reconciliation state themselves flip this on so
   * users never hear the same change twice.
   */
  disableAnnouncements?: boolean;
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
let reconInstanceCount = -1;

export class Reconciliation {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private section: HTMLElement | undefined;
  private matches: ReconciliationMatch[];
  private lastLines: readonly StatementLine[];
  private lastPostings: readonly BookPostingRef[];
  /**
   * Polite live region for difference announcements. Lives as a stable
   * SIBLING of the section inside the shadow root — the section is replaced
   * wholesale on every state change (innerHTML re-render), and a region
   * inside it would be destroyed and re-announced per render. Created empty
   * on both render and hydrate paths, so SSR output never replays a stale
   * announcement.
   */
  private liveRegion: LiveRegion | undefined;

  /** Unique per instance, prefixes worker cache keys so instances never collide. */
  private readonly workerInstanceId: string = `recon-${++reconInstanceCount}`;
  /** Bumped per data change; stale async proposal results are dropped. */
  private proposalsVersion = 0;

  constructor(
    public options: ReconciliationOptions,
    private isContainerManaged = false
  ) {
    this.lastLines = options.statementLines;
    this.lastPostings = options.postings;
    this.matches = this.initializeMatches();
  }

  // Replaces options. New statement/posting/match data (by reference)
  // re-derives the match set; callback- or label-only changes keep the
  // in-flight accept/reject state untouched.
  setOptions(options: ReconciliationOptions | undefined): void {
    if (options == null) return;
    // Reference bail-out (the Register.setRows idiom): the React adapter
    // calls this on every committed render, and with `options.matches`
    // supplied the dataChanged test below would otherwise re-derive the
    // match set — blowing away in-flight accept/reject state — even though
    // nothing changed. Fresh options objects (the documented data-change
    // signal) still take the full path.
    if (options === this.options) {
      return;
    }
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
      this.matches = this.initializeMatches();
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
    this.ensureLiveRegion(shadowRoot);
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
    this.ensureLiveRegion(shadowRoot);
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
    this.liveRegion?.cleanUp();
    this.liveRegion = undefined;
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.section = undefined;
  }

  // One live region per component instance, created lazily on first mount
  // and never recreated: rerender() replaces the section element but leaves
  // this sibling untouched, so screen readers keep tracking one stable
  // node. Skipped entirely under disableAnnouncements — no region, no
  // announcements, nothing for host-owned narration to collide with.
  private ensureLiveRegion(shadowRoot: ShadowRoot): void {
    if (this.options.disableAnnouncements === true || this.liveRegion != null) {
      return;
    }
    this.liveRegion = createLiveRegion(shadowRoot);
  }

  // Concise post-transition status for assistive tech: the per-currency
  // difference figures the header shows visually (only nonzero currencies —
  // the point is what still needs work), or the reconciled verdict once
  // every currency hits zero. Called exactly once per discrete state
  // change: transitionMatch is the single mutation entry point and each
  // accept/reject/undo triggers one synchronous re-render, so multi-step
  // sequences produce one announcement per step, never a storm. Data
  // replacement (setOptions) and async proposal arrival deliberately stay
  // silent: they are not user-driven state changes.
  private announceDifference(): void {
    if (this.liveRegion == null || this.options.disableAnnouncements === true) {
      return;
    }
    const { difference } = computeReconciliationTotals(this.getRenderState());
    const parts: string[] = [];
    for (const [currency, amount] of difference) {
      if (amount !== 0) {
        parts.push(
          `${currency} difference ${formatMinorUnits(amount, currency)}`
        );
      }
    }
    this.liveRegion.announce(
      parts.length === 0 ? 'All currencies reconciled' : parts.join('; ')
    );
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
    this.announceDifference();
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
  // Seed matches from options: an explicit list wins (statuses respected).
  // Without a worker pool the deterministic proposal engine runs inline;
  // with one, the seed is empty and the engine's (identical, deterministic)
  // result lands asynchronously on the next animation frame after it
  // resolves.
  private initializeMatches(): ReconciliationMatch[] {
    const { options } = this;
    if (options.matches != null) {
      return [...options.matches];
    }
    const pool = options.workerPool;
    if (pool == null || !pool.isWorkingPool()) {
      return proposeMatches(options.statementLines, options.postings, {
        dateWindowDays: options.dateWindowDays,
        maxGroupSize: options.maxGroupSize,
      });
    }
    this.refreshProposalsViaPool();
    return [];
  }

  private refreshProposalsViaPool(): void {
    const pool = this.options.workerPool;
    if (pool == null) {
      return;
    }
    const version = ++this.proposalsVersion;
    const { statementLines, postings, dateWindowDays, maxGroupSize } =
      this.options;
    void pool
      .proposeMatches({
        statementLines,
        postings,
        options: { dateWindowDays, maxGroupSize },
        cacheKey: `${this.workerInstanceId}:${version}`,
      })
      .then((matches) => {
        if (version !== this.proposalsVersion) {
          return;
        }
        queueRender(() => {
          if (version !== this.proposalsVersion) {
            return;
          }
          this.matches = matches;
          this.rerender();
        });
      })
      .catch(() => {
        // Pool terminated mid-flight: recompute inline if still current.
        if (version !== this.proposalsVersion) {
          return;
        }
        this.matches = proposeMatches(statementLines, postings, {
          dateWindowDays,
          maxGroupSize,
        });
        this.rerender();
      });
  }
}
