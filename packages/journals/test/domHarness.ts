import { JSDOM } from 'jsdom';

import type {
  BookPostingRef,
  LedgerEntry,
  MinorUnits,
  Posting,
  RegisterRowData,
  StatementLine,
} from '../src/types';

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
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    IntersectionObserver: Reflect.get(globalThis, 'IntersectionObserver'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  // jsdom does not implement PointerEvent; tests dispatch this MouseEvent
  // subclass instead, carrying the pointer fields InteractionManager reads.
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
  // observed target as intersecting so the Virtualizer treats all connected
  // sections as visible and window-math tests exercise the real render path.
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
  // The callback is kept alongside the timer so cleanup() can FLUSH pending
  // frames instead of dropping them: the shared UniversalRenderingManager
  // holds a module-level frameId across test files, and silently discarding
  // a scheduled frame would leave it stale and stall every later suite.
  interface PendingFrame {
    timeout: ReturnType<typeof setTimeout>;
    callback: FrameRequestCallback;
  }
  let nextFrameId = 0;
  const frames = new Map<number, PendingFrame>();

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const frame = frames.get(id);
      if (frame != null) {
        clearTimeout(frame.timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    document: dom.window.document,
    DocumentFragment: dom.window.DocumentFragment,
    Element: dom.window.Element,
    Event: dom.window.Event,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    IntersectionObserver: MockIntersectionObserver,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    PointerEvent: MockPointerEvent,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, { timeout, callback });
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
      // Flush (not drop) pending frames so shared rAF-queue singletons see
      // their scheduled frame complete and reset their state for the next
      // suite. Bounded in case a flushed callback keeps rescheduling.
      for (let pass = 0; pass < 10 && frames.size > 0; pass += 1) {
        const pending = [...frames.values()];
        frames.clear();
        for (const frame of pending) {
          clearTimeout(frame.timeout);
          try {
            frame.callback(performance.now());
          } catch {
            // Cleanup must not fail because a late frame touched dead DOM.
          }
        }
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
// explicitly: fixes the bounding-rect height and scrollHeight the Virtualizer
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

export function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MakeEntryOptions {
  id?: string;
  date?: string;
  flag?: LedgerEntry['flag'];
  payee?: string | null;
  narration?: string;
  tags?: readonly string[];
  links?: readonly string[];
  postings?: readonly Posting[];
}

// Handcrafted balanced entry with stable values so projections and the
// snapshot canary stay deterministic.
export function makeEntry(options: MakeEntryOptions = {}): LedgerEntry {
  return {
    id: options.id ?? 'entry-1',
    date: options.date ?? '2026-07-18',
    flag: options.flag ?? 'cleared',
    payee: options.payee !== undefined ? options.payee : 'Acme Sdn Bhd',
    narration: options.narration ?? 'Monthly consulting invoice',
    tags: options.tags ?? ['ops'],
    links: options.links ?? ['inv-42'],
    postings: options.postings ?? [
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
  };
}

// Deterministic register rows: alternating debits/credits against one
// account with an exact running balance per row.
export function makeRows(count: number): RegisterRowData[] {
  const rows: RegisterRowData[] = [];
  let balance: MinorUnits = 0;
  for (let index = 0; index < count; index += 1) {
    const amount = index % 3 === 2 ? -2_500 : 10_000 + index;
    balance += amount;
    const entry = makeEntry({
      id: `entry-${index}`,
      payee: `Payee ${index}`,
      narration: `Narration ${index}`,
      tags: [],
      links: [],
      postings: [
        { account: 'Assets:Current:Cash-Maybank', amount, currency: 'MYR' },
        {
          account: 'Income:Sales:Consulting',
          amount: -amount,
          currency: 'MYR',
        },
      ],
    });
    rows.push({
      entry,
      posting: entry.postings[0],
      runningBalance: new Map([['MYR', balance]]),
    });
  }
  return rows;
}

export interface MakeStatementLineOptions {
  id: string;
  date: string;
  amount: MinorUnits;
  description?: string;
  currency?: string;
}

/** Handcrafted statement line for reconciliation fixtures. */
export function makeStatementLine({
  id,
  date,
  amount,
  description,
  currency = 'MYR',
}: MakeStatementLineOptions): StatementLine {
  return {
    id,
    date,
    description: description ?? `Statement ${id}`,
    amount,
    currency,
  };
}

export interface MakeBookPostingOptions {
  entryId: string;
  date: string;
  amount: MinorUnits;
  payee?: string;
  currency?: string;
  account?: string;
}

// Book-side posting reference: a balanced two-posting entry whose first
// posting hits the reconciled account (postingIndex 0).
export function makeBookPosting({
  entryId,
  date,
  amount,
  payee,
  currency = 'MYR',
  account = 'Assets:Current:Cash-Maybank',
}: MakeBookPostingOptions): BookPostingRef {
  const entry = makeEntry({
    id: entryId,
    date,
    payee: payee ?? `Payee ${entryId}`,
    narration: `Narration ${entryId}`,
    tags: [],
    links: [],
    postings: [
      { account, amount, currency },
      { account: 'Income:Sales:Consulting', amount: -amount, currency },
    ],
  });
  return { entry, postingIndex: 0 };
}
