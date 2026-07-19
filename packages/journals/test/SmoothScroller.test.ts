import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  DEFAULT_SMOOTH_SCROLL_SETTINGS,
  MAX_SMOOTH_SCROLL_FRAME_DT,
} from '../src/constants';
import { SmoothScroller } from '../src/utils/SmoothScroller';
import { type DomHandle, installDom } from './domHarness';

let dom: DomHandle;

// Deterministic frame pump: the shared UniversalRenderingManager schedules
// through requestAnimationFrame, so replacing rAF with a manual queue lets
// tests drive the spring with FAKE timestamps instead of waiting wall-clock
// time for a ~440ms glide. Frames are flushed after every test so the
// manager's module-level frameId never goes stale for later suites.
let pendingFrames: FrameRequestCallback[] = [];
let originalRaf: typeof requestAnimationFrame;
let originalCaf: typeof cancelAnimationFrame;

function pumpFrame(time: number): void {
  const frames = pendingFrames;
  pendingFrames = [];
  for (const frame of frames) {
    frame(time);
  }
}

// Advances fake time in fixed steps until the scroller settles (bounded so
// a non-converging spring fails the test instead of hanging it).
function pumpUntilSettled(
  scroller: SmoothScroller,
  startTime: number,
  stepMs = 16,
  maxFrames = 500
): number {
  let time = startTime;
  for (let frame = 0; frame < maxFrames && scroller.isActive(); frame += 1) {
    time += stepMs;
    pumpFrame(time);
  }
  return time;
}

beforeAll(() => {
  dom = installDom();
  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
  dom.cleanup();
});

afterEach(() => {
  // Flush anything a test left queued so the shared manager's frame state
  // resets (bounded: a callback may re-queue).
  for (let pass = 0; pass < 20 && pendingFrames.length > 0; pass += 1) {
    pumpFrame(1e9 + pass);
  }
  pendingFrames = [];
});

function createScrollerElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.scrollTop = 0;
  return element;
}

describe('SmoothScroller spring animation', () => {
  test('converges to the target through intermediate positions and settles exactly', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    expect(scroller.isActive()).toBe(true);

    pumpFrame(0); // Establishes the time base; no movement yet.
    pumpFrame(16);
    pumpFrame(32);
    const early = element.scrollTop;
    // Mid-flight the position is strictly between start and target — the
    // animation visibly glides instead of jumping.
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1000);

    pumpUntilSettled(scroller, 32);
    expect(scroller.isActive()).toBe(false);
    // Settle snaps exactly onto the target, never an epsilon short.
    expect(element.scrollTop).toBe(1000);
    element.remove();
  });

  test('never overshoots the target (critical damping)', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(500);
    let time = 0;
    pumpFrame(time);
    for (let frame = 0; frame < 500 && scroller.isActive(); frame += 1) {
      time += 16;
      pumpFrame(time);
      expect(element.scrollTop).toBeLessThanOrEqual(500);
    }
    expect(element.scrollTop).toBe(500);
    element.remove();
  });

  test('retargeting mid-flight continues from current position and velocity', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    pumpFrame(16);
    pumpFrame(32);
    pumpFrame(48);
    const beforeRetarget = element.scrollTop;
    expect(beforeRetarget).toBeGreaterThan(0);

    // Retarget downward mid-flight: still one active animation, and the
    // next frame moves a bounded step from the current position — no jump
    // to either the old or the new target.
    scroller.scrollTo(200);
    expect(scroller.isActive()).toBe(true);
    pumpFrame(64);
    const afterRetarget = element.scrollTop;
    expect(afterRetarget).not.toBe(200);
    expect(Math.abs(afterRetarget - beforeRetarget)).toBeLessThan(200);

    pumpUntilSettled(scroller, 64);
    expect(element.scrollTop).toBe(200);
    element.remove();
  });

  test('cancel stops the animation where it is', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    pumpFrame(16);
    pumpFrame(32);
    const atCancel = element.scrollTop;
    scroller.cancel();
    expect(scroller.isActive()).toBe(false);
    // Further frames are inert: cancel means the position stays put.
    pumpFrame(48);
    pumpFrame(200);
    expect(element.scrollTop).toBe(atCancel);
    element.remove();
  });

  test('user wheel input cancels an active animation immediately', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    pumpFrame(16);
    expect(scroller.isActive()).toBe(true);
    element.dispatchEvent(new window.Event('wheel'));
    expect(scroller.isActive()).toBe(false);
    const atCancel = element.scrollTop;
    pumpFrame(32);
    expect(element.scrollTop).toBe(atCancel);
    element.remove();
  });

  test('scroll-key keydown cancels; unrelated keys do not', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
    expect(scroller.isActive()).toBe(true);
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'PageDown' })
    );
    expect(scroller.isActive()).toBe(false);
    element.remove();
  });

  test('prefers-reduced-motion jumps instantly', () => {
    const element = createScrollerElement();
    const originalMatchMedia = window.matchMedia;
    // jsdom's matchMedia never matches; stub an explicit `reduce` match.
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const scroller = new SmoothScroller(() => element);
      scroller.scrollTo(1000);
      expect(element.scrollTop).toBe(1000);
      expect(scroller.isActive()).toBe(false);
      expect(pendingFrames.length).toBe(0);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
    element.remove();
  });

  test("behavior 'auto' jumps instantly and cancels any active animation", () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    pumpFrame(16);
    expect(scroller.isActive()).toBe(true);
    scroller.scrollTo(300, 'auto');
    expect(element.scrollTop).toBe(300);
    expect(scroller.isActive()).toBe(false);
    element.remove();
  });

  test('frame delta is clamped so background-tab gaps glide instead of teleporting', () => {
    const element = createScrollerElement();
    const scroller = new SmoothScroller(() => element);
    scroller.scrollTo(1000);
    pumpFrame(0);
    // A 10-second frame gap: unclamped, e^(-omega*dt) underflows to 0 and
    // the spring lands exactly on the target in one frame. Clamped to
    // MAX_SMOOTH_SCROLL_FRAME_DT it advances only one 50ms step.
    pumpFrame(10_000);
    expect(scroller.isActive()).toBe(true);
    expect(element.scrollTop).toBeLessThan(1000);
    // The single clamped step equals a genuine 50ms step from rest.
    const { omega } = DEFAULT_SMOOTH_SCROLL_SETTINGS;
    const dt = MAX_SMOOTH_SCROLL_FRAME_DT;
    const decay = Math.exp(-omega * dt);
    const expected = 1000 + (-1000 + omega * -1000 * dt) * decay;
    expect(element.scrollTop).toBeCloseTo(expected, 6);
    scroller.cancel();
    element.remove();
  });

  test('onScrollFrame fires on every animated write and on instant jumps', () => {
    const element = createScrollerElement();
    let frames = 0;
    const scroller = new SmoothScroller(() => element, {
      onScrollFrame: () => {
        frames += 1;
      },
    });
    scroller.scrollTo(400, 'auto');
    expect(frames).toBe(1);
    scroller.scrollTo(1000);
    pumpFrame(0);
    pumpFrame(16);
    pumpFrame(32);
    expect(frames).toBeGreaterThanOrEqual(3);
    scroller.cancel();
    element.remove();
  });
});
