import { queueRender } from '../managers/UniversalRenderingManager';
import type { VirtualWindowSpecs } from '../types';
import { areVirtualWindowSpecsEqual } from '../utils/areVirtualWindowSpecsEqual';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';

export interface VirtualizedInstance {
  /**
   * Called with the current pixel window whenever it changes (or when
   * `force` marks container geometry dirty). Returns true when the instance
   * mutated the DOM, which schedules a corrected follow-up pass.
   */
  onRender(windowSpecs: VirtualWindowSpecs, force: boolean): boolean;
  /** Visibility toggle from the IntersectionObserver watching the section. */
  setVisibility(visible: boolean): void;
}

// 800 seems like the healthy overscan required to keep safari from
// blanking during momentum scrolls... if we catch it tho, maybe 900
const DEFAULT_OVERSCROLL_SIZE = 800;
const INTERSECTION_OBSERVER_MARGIN = DEFAULT_OVERSCROLL_SIZE * 4;
const INTERSECTION_OBSERVER_THRESHOLD = [0, 0.000001, 0.99999, 1];

export interface VirtualizerConfig {
  /** Extra pixels rendered above and below the viewport to reduce blanking during fast scrolls. */
  overscrollSize: number;
  /** Margin used by IntersectionObserver to decide when sections should be considered visible. */
  intersectionObserverMargin: number;
}

const DEFAULT_VIRTUALIZER_CONFIG: VirtualizerConfig = {
  overscrollSize: DEFAULT_OVERSCROLL_SIZE,
  intersectionObserverMargin: INTERSECTION_OBSERVER_MARGIN,
};

let instanceCount = -1;

// Windowing engine shared by Register and LedgerView. One Virtualizer owns
// one scroll container; each Register section connects its root element and
// receives pixel-window callbacks. Geometry reads (scrollTop/height/
// scrollHeight) are cached behind dirty flags so a burst of scroll events
// costs one layout read per frame, and all work is funneled through the
// shared rAF queue.
export class Virtualizer {
  public readonly __id: string = `journals-virtualizer-${++instanceCount}`;
  public readonly config: VirtualizerConfig;

  private root: HTMLElement | undefined;
  private contentContainer: HTMLElement | undefined;
  private intersectionObserver: IntersectionObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private scrollTop = 0;
  private height = 0;
  private scrollHeight = 0;
  private scrollDirty = true;
  private heightDirty = true;
  private scrollHeightDirty = true;
  private windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };

  private observers: Map<HTMLElement, VirtualizedInstance> = new Map();
  private visibleInstances: Map<HTMLElement, VirtualizedInstance> = new Map();
  private visibleInstancesDirty = false;
  private connectQueue: Map<HTMLElement, VirtualizedInstance> = new Map();

  constructor(config?: Partial<VirtualizerConfig>) {
    this.config = { ...DEFAULT_VIRTUALIZER_CONFIG, ...config };
  }

  setup(root: HTMLElement, contentContainer?: Element): void {
    if (this.root != null) {
      return;
    }
    this.root = root;
    this.resizeObserver = new ResizeObserver(this.handleContainerResize);
    this.intersectionObserver = new IntersectionObserver(
      this.handleIntersectionChange,
      {
        root: this.root,
        threshold: INTERSECTION_OBSERVER_THRESHOLD,
        rootMargin: `${this.config.intersectionObserverMargin}px 0px ${this.config.intersectionObserverMargin}px 0px`,
      }
    );
    root.addEventListener('scroll', this.handleScroll, { passive: true });
    this.resizeObserver.observe(root);
    contentContainer ??= root.firstElementChild ?? undefined;
    if (contentContainer instanceof HTMLElement) {
      this.contentContainer = contentContainer;
      this.resizeObserver.observe(contentContainer);
    }
    // Connections that raced against setup were parked; flush them now that
    // the IntersectionObserver exists.
    for (const [container, instance] of this.connectQueue.entries()) {
      this.connect(container, instance);
    }
    this.connectQueue.clear();
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  }

  connect(container: HTMLElement, instance: VirtualizedInstance): () => void {
    if (this.observers.has(container)) {
      throw new Error('Virtualizer.connect: instance is already connected...');
    }
    // If we are racing against the intersectionObserver, then we should just
    // queue up the connection for when the observer does get set up
    if (this.intersectionObserver == null) {
      this.connectQueue.set(container, instance);
    } else {
      this.intersectionObserver.observe(container);
      this.observers.set(container, instance);
      this.markDOMDirty();
      queueRender(this.computeRenderRangeAndEmit);
    }
    return () => this.disconnect(container);
  }

  disconnect(container: HTMLElement): void {
    const instance = this.observers.get(container);
    this.connectQueue.delete(container);
    if (instance == null) {
      return;
    }
    this.intersectionObserver?.unobserve(container);
    this.observers.delete(container);
    if (this.visibleInstances.delete(container)) {
      this.visibleInstancesDirty = true;
    }
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  }

  /** Current pixel window; computed lazily on first read. */
  getWindowSpecs(): VirtualWindowSpecs {
    if (this.windowSpecs.top === 0 && this.windowSpecs.bottom === 0) {
      this.windowSpecs = createWindowFromScrollPosition({
        scrollTop: this.getScrollTop(),
        height: this.getHeight(),
        scrollHeight: this.getScrollHeight(),
        overscrollSize: this.config.overscrollSize,
      });
    }
    return this.windowSpecs;
  }

  /** Schedules a render pass; call after data mutations that change heights. */
  instanceChanged(): void {
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  }

  cleanUp(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
    this.root = undefined;
    this.contentContainer = undefined;
    this.observers.clear();
    this.visibleInstances.clear();
    this.connectQueue.clear();
    this.visibleInstancesDirty = false;
    this.windowSpecs = { top: 0, bottom: 0 };
    this.scrollTop = 0;
    this.height = 0;
    this.scrollHeight = 0;
  }

  private handleScroll = (): void => {
    this.scrollDirty = true;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private handleContainerResize = (entries: ResizeObserverEntry[]): void => {
    if (this.root == null) return;
    let shouldQueueUpdate = false;
    for (const entry of entries) {
      if (entry.target === this.root) {
        this.heightDirty = true;
        shouldQueueUpdate = true;
      } else if (entry.target === this.contentContainer) {
        this.scrollHeightDirty = true;
        shouldQueueUpdate = true;
      }
    }
    if (shouldQueueUpdate) {
      queueRender(this.computeRenderRangeAndEmit);
    }
  };

  private handleIntersectionChange = (
    entries: IntersectionObserverEntry[]
  ): void => {
    this.scrollDirty = true;
    for (const { target, isIntersecting } of entries) {
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      const instance = this.observers.get(target);
      // IntersectionObserver delivers entries asynchronously, so an entry can
      // arrive after the target was unobserved via disconnect().
      if (instance == null) {
        continue;
      }
      if (isIntersecting && !this.visibleInstances.has(target)) {
        instance.setVisibility(true);
        this.visibleInstances.set(target, instance);
        this.visibleInstancesDirty = true;
      } else if (!isIntersecting && this.visibleInstances.has(target)) {
        instance.setVisibility(false);
        this.visibleInstances.delete(target);
        this.visibleInstancesDirty = true;
      }
    }
    if (this.visibleInstancesDirty) {
      queueRender(this.computeRenderRangeAndEmit);
    }
  };

  private computeRenderRangeAndEmit = (): void => {
    const wrapperDirty = this.heightDirty || this.scrollHeightDirty;
    if (!this.scrollDirty && !wrapperDirty && !this.visibleInstancesDirty) {
      return;
    }
    const windowSpecs = createWindowFromScrollPosition({
      scrollTop: this.getScrollTop(),
      height: this.getHeight(),
      scrollHeight: this.getScrollHeight(),
      overscrollSize: this.config.overscrollSize,
    });
    if (
      !wrapperDirty &&
      !this.visibleInstancesDirty &&
      areVirtualWindowSpecsEqual(this.windowSpecs, windowSpecs)
    ) {
      return;
    }
    this.windowSpecs = windowSpecs;
    this.visibleInstancesDirty = false;

    // If the wrapper resized, geometry may have shifted for every section,
    // so force offscreen instances to re-render too.
    let domChanged = false;
    for (const instance of wrapperDirty
      ? this.observers.values()
      : this.visibleInstances.values()) {
      if (instance.onRender(windowSpecs, wrapperDirty)) {
        domChanged = true;
      }
    }
    // Spacer mutations change scrollHeight; schedule a corrected pass so the
    // window converges on the post-mutation geometry.
    if (domChanged) {
      this.markDOMDirty();
      queueRender(this.computeRenderRangeAndEmit);
    }
  };

  private getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    let scrollTop = this.root?.scrollTop ?? 0;
    // Always clamp for over/bounce scroll so the window never goes negative
    // or past the content.
    scrollTop = Math.max(
      0,
      Math.min(scrollTop, this.getScrollHeight() - this.getHeight())
    );
    this.scrollTop = scrollTop;
    return scrollTop;
  }

  private getScrollHeight(): number {
    if (!this.scrollHeightDirty) {
      return this.scrollHeight;
    }
    this.scrollHeightDirty = false;
    this.scrollHeight = this.root?.scrollHeight ?? 0;
    return this.scrollHeight;
  }

  private getHeight(): number {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = this.root?.getBoundingClientRect().height ?? 0;
    return this.height;
  }

  private markDOMDirty(): void {
    this.scrollDirty = true;
    this.scrollHeightDirty = true;
    this.heightDirty = true;
  }
}
