import { JSDOM } from 'jsdom';

import type { LedgerEntry } from '../src/types';

export interface DomHandle {
  window: JSDOM['window'];
  cleanup(): void;
}

// Installs a jsdom-backed DOM environment on globalThis for component tests.
// Always installs the same superset of globals: per-file subsets drifted
// apart in the past (in the reference codebase) and caused harness bugs,
// while unused extras are harmless. The returned cleanup() restores (or
// deletes) every global it touched.
export function installDom(): DomHandle {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator'
  );
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
    Element: Reflect.get(globalThis, 'Element'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLInputElement: Reflect.get(globalThis, 'HTMLInputElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    IntersectionObserver: Reflect.get(globalThis, 'IntersectionObserver'),
    KeyboardEvent: Reflect.get(globalThis, 'KeyboardEvent'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  // jsdom does not implement PointerEvent; tests dispatch this MouseEvent
  // subclass instead, carrying the pointer fields event delegation reads.
  class MockPointerEvent extends dom.window.MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }

  class MockResizeObserver {
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }

  // jsdom performs no layout, so intersection is meaningless; report every
  // observed target as intersecting so any observer-driven code treats all
  // connected sections as visible.
  class MockIntersectionObserver {
    constructor(
      private callback: (
        entries: Array<{ target: Element; isIntersecting: boolean }>,
        observer: MockIntersectionObserver
      ) => void
    ) {}

    observe(target: Element): void {
      this.callback([{ target, isIntersecting: true }], this);
    }

    unobserve(_target: Element): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }

  // Bun defines globalThis.navigator as a non-writable accessor, so the
  // override has to go through defineProperty and be restored from the saved
  // property descriptor rather than plain assignment.
  const navigator = Object.create(dom.window.navigator) as Navigator;

  // Bun has no requestAnimationFrame; back frames with setTimeout so renders
  // scheduled via rAF run on the macrotask queue and wait(0) can flush them.
  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const timeout = frames.get(id);
      if (timeout != null) {
        clearTimeout(timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    document: dom.window.document,
    DocumentFragment: dom.window.DocumentFragment,
    Element: dom.window.Element,
    Event: dom.window.Event,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    IntersectionObserver: MockIntersectionObserver,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    PointerEvent: MockPointerEvent,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, timeout);
      return id;
    }) as typeof requestAnimationFrame,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  });
  Object.assign(dom.window, {
    PointerEvent: MockPointerEvent,
    IntersectionObserver: MockIntersectionObserver,
    ResizeObserver: MockResizeObserver,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: navigator,
  });

  return {
    window: dom.window,
    cleanup() {
      for (const timeout of frames.values()) {
        clearTimeout(timeout);
      }
      frames.clear();

      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      if (originalNavigatorDescriptor == null) {
        Reflect.deleteProperty(globalThis, 'navigator');
      } else {
        Object.defineProperty(
          globalThis,
          'navigator',
          originalNavigatorDescriptor
        );
      }
      dom.window.close();
    },
  };
}

export interface ScrollerGeometry {
  height: number;
  scrollHeight: number;
}

// jsdom performs no layout, so scroll-container geometry has to be declared
// explicitly: fixes the bounding-rect height and scrollHeight the view
// reads, and stubs scrollTo so scroll clamping behaves like a real element.
export function stubScrollerGeometry(
  element: HTMLElement,
  { height, scrollHeight }: ScrollerGeometry
): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  element.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    element.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
  };
}

export function dispatchScroll(element: HTMLElement): void {
  element.dispatchEvent(new window.Event('scroll'));
}

export function dispatchKey(
  element: HTMLElement,
  key: string,
  init: KeyboardEventInit = {}
): void {
  element.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

export function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handcrafted deterministic chart of accounts. Fully expanded (sibling sort
 * is code-point order on leaf names) the projection is:
 *
 *  0 Assets                      (group)
 *  1 Assets:Current              (group)
 *  2 Assets:Current:Cash-CIMB    (leaf)
 *  3 Assets:Current:Cash-Maybank (leaf)
 *  4 Assets:Fixed                (group)
 *  5 Assets:Fixed:Equipment      (leaf)
 *  6 Expenses                    (group)
 *  7 Expenses:Rent               (leaf)
 *  8 Income                      (group)
 *  9 Income:Sales                (group)
 * 10 Income:Sales:Consulting     (leaf)
 * 11 Liabilities                 (group)
 * 12 Liabilities:Current         (group)
 * 13 Liabilities:Current:AP      (leaf)
 */
export const CHART_ACCOUNTS: readonly string[] = [
  'Assets:Current:Cash-Maybank',
  'Assets:Current:Cash-CIMB',
  'Assets:Fixed:Equipment',
  'Expenses:Rent',
  'Income:Sales:Consulting',
  'Liabilities:Current:AP',
];

/**
 * Balanced entries giving the chart stable balances:
 * MYR rolled — Assets 700.00, Cash-Maybank 700.00, Expenses 800.00,
 * Income −1,500.00; Cash-CIMB carries USD only (no MYR balance).
 */
export function makeChartEntries(): LedgerEntry[] {
  return [
    {
      id: 'e1',
      date: '2026-07-01',
      flag: 'cleared',
      payee: 'Acme Sdn Bhd',
      narration: 'Consulting invoice',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 150_000,
          currency: 'MYR',
        },
        {
          account: 'Income:Sales:Consulting',
          amount: -150_000,
          currency: 'MYR',
        },
      ],
    },
    {
      id: 'e2',
      date: '2026-07-02',
      flag: 'cleared',
      payee: 'Hartanah Prima Sdn Bhd',
      narration: 'Office rent',
      tags: [],
      links: [],
      postings: [
        { account: 'Expenses:Rent', amount: 80_000, currency: 'MYR' },
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: -80_000,
          currency: 'MYR',
        },
      ],
    },
    {
      id: 'e3',
      date: '2026-07-03',
      flag: 'pending',
      payee: 'Acme Corp (Singapore)',
      narration: 'Export sale',
      tags: [],
      links: [],
      postings: [
        {
          account: 'Assets:Current:Cash-CIMB',
          amount: 5_000,
          currency: 'USD',
        },
        {
          account: 'Income:Sales:Consulting',
          amount: -5_000,
          currency: 'USD',
        },
      ],
    },
  ];
}

/** Synthetic wide chart for virtualization math: `T00:L00`…, no entries. */
export function makeWideChart(tops: number, leavesPerTop: number): string[] {
  const paths: string[] = [];
  for (let top = 0; top < tops; top += 1) {
    for (let leaf = 0; leaf < leavesPerTop; leaf += 1) {
      paths.push(
        `T${String(top).padStart(2, '0')}:L${String(leaf).padStart(2, '0')}`
      );
    }
  }
  return paths;
}
