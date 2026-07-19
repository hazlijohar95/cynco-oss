import {
  DEFAULT_SMOOTH_SCROLL_SETTINGS,
  MAX_SMOOTH_SCROLL_FRAME_DT,
} from '../constants';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type { SmoothScrollSettings } from '../types';
import { prefersReducedMotion } from './prefersReducedMotion';

export interface SmoothScrollerOptions {
  /** Spring tuning; defaults to {@link DEFAULT_SMOOTH_SCROLL_SETTINGS}. */
  settings?: SmoothScrollSettings;
  /**
   * Invoked after every programmatic scrollTop write (each animation frame
   * and the instant-jump path). Components wire this to
   * `Virtualizer.instanceChanged()` so row windows track the animated
   * position even in environments where programmatic scrollTop writes fire
   * no scroll event (jsdom); in browsers the duplicate wake-up is deduped
   * by the shared rAF queue.
   */
  onScrollFrame?(): void;
}

// Keys that scroll a focused scroll container natively. A keydown for any of
// these is user scroll intent and must win over a programmatic animation;
// other keys (typing, shortcuts) deliberately do NOT cancel.
const SCROLL_KEYS = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

/**
 * Critically-damped spring animator for a scroll container's scrollTop —
 * the one scroll engine shared by Register and LedgerView (one instance per
 * scroll container, so concurrent scroll-to calls retarget a single spring
 * instead of two animators fighting over scrollTop).
 *
 * Damping model: critical damping (damping ratio exactly 1) is the unique
 * regime that converges as fast as possible with zero overshoot — a scroll
 * position must never fly past its row and bounce back. With that ratio
 * pinned, the closed-form ODE step below has a single knob, `omega`
 * (stiffness/natural frequency). The closed form is stable at ANY dt (an
 * Euler integration would explode once `omega * dt ≳ 1`), and dt is
 * additionally clamped so background-tab rAF gaps glide instead of
 * teleporting.
 *
 * Frames ride the shared UniversalRenderingManager rAF funnel (`queueRender`)
 * — never a private rAF loop — so an animating scroller costs the page the
 * same single frame callback as everything else.
 */
export class SmoothScroller {
  private target = 0;
  /** Simulated position; tracked separately so browser clamping of the
   * scrollTop write never corrupts the spring state. */
  private position = 0;
  private velocity = 0;
  private active = false;
  private lastTimestamp: number | null = null;
  /** The exact element the cancel listeners were attached to — detach must
   * target it even if getScroller() resolves differently later. */
  private attachedScroller: HTMLElement | undefined;

  constructor(
    private readonly getScroller: () => HTMLElement | undefined,
    private readonly options: SmoothScrollerOptions = {}
  ) {}

  /**
   * Starts (or retargets) a scroll toward `targetTop`. Retargeting
   * mid-flight is seamless: the spring keeps its current position and
   * velocity and simply pulls toward the new destination, so chained
   * scroll-to calls glide instead of restarting. `behavior: 'auto'` — or an
   * OS-level reduced-motion preference — cancels any active animation and
   * jumps instantly.
   */
  scrollTo(targetTop: number, behavior: 'smooth' | 'auto' = 'smooth'): void {
    const scroller = this.getScroller();
    if (scroller == null) {
      return;
    }
    if (behavior === 'auto' || prefersReducedMotion()) {
      this.cancel();
      scroller.scrollTop = targetTop;
      this.options.onScrollFrame?.();
      return;
    }
    this.target = targetTop;
    if (!this.active) {
      this.active = true;
      this.position = scroller.scrollTop;
      this.velocity = 0;
      this.lastTimestamp = null;
      this.attachCancelListeners(scroller);
      queueRender(this.step);
    }
  }

  /** Stops an active animation, leaving scrollTop wherever the last frame
   * put it (no snap — cancel means "the user took over"). */
  cancel(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.lastTimestamp = null;
    dequeueRender(this.step);
    this.detachCancelListeners();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Cancels and releases listeners; safe to call repeatedly. */
  cleanUp(): void {
    this.cancel();
  }

  // One closed-form critically-damped ODE step per shared-rAF frame:
  // x(t) = target + (x0 + (v0 + ω·x0)·t)·e^(−ω·t) with x measured as
  // displacement from the target. Exact for any dt, so frame jitter can
  // only change smoothness, never stability.
  private step = (time: number): void => {
    if (!this.active) {
      return;
    }
    const scroller = this.getScroller();
    if (scroller == null) {
      this.cancel();
      return;
    }
    // First frame establishes the time base and writes nothing new; the dt
    // clamp keeps a backgrounded tab's multi-second frame gap from advancing
    // the spring to (nearly) its target in one hop.
    const dt =
      this.lastTimestamp == null
        ? 0
        : Math.min(MAX_SMOOTH_SCROLL_FRAME_DT, time - this.lastTimestamp);
    this.lastTimestamp = time;
    const { omega, epsilonPx, epsilonVelocity } =
      this.options.settings ?? DEFAULT_SMOOTH_SCROLL_SETTINGS;
    const decay = Math.exp(-omega * dt);
    const displacement = this.position - this.target;
    const springCoeff = this.velocity + omega * displacement;
    this.position = this.target + (displacement + springCoeff * dt) * decay;
    this.velocity =
      (springCoeff * (1 - omega * dt) - omega * displacement) * decay;

    if (
      Math.abs(this.target - this.position) <= epsilonPx &&
      Math.abs(this.velocity) <= epsilonVelocity
    ) {
      // Settle: snap exactly onto the target so row math downstream sees an
      // integer-true position, then release everything.
      scroller.scrollTop = this.target;
      this.options.onScrollFrame?.();
      this.cancel();
      return;
    }
    scroller.scrollTop = this.position;
    this.options.onScrollFrame?.();
    queueRender(this.step);
  };

  /**
   * User input wins: any user scroll gesture on the container cancels the
   * programmatic animation immediately (wheel/touch for trackpads and
   * fingers, pointerdown for scrollbar drags, scroll-key keydowns for
   * keyboard scrolling). Listeners are passive (they only cancel — never
   * preventDefault) and exist ONLY while an animation is active: attached on
   * start, detached on settle/cancel, so an idle scroller pays zero listener
   * cost per event.
   */
  private attachCancelListeners(scroller: HTMLElement): void {
    if (this.attachedScroller != null) {
      return;
    }
    this.attachedScroller = scroller;
    scroller.addEventListener('wheel', this.handleUserScrollIntent, {
      passive: true,
    });
    scroller.addEventListener('touchstart', this.handleUserScrollIntent, {
      passive: true,
    });
    scroller.addEventListener('pointerdown', this.handleUserScrollIntent, {
      passive: true,
    });
    scroller.addEventListener('keydown', this.handleUserScrollIntent, {
      passive: true,
    });
  }

  private detachCancelListeners(): void {
    const scroller = this.attachedScroller;
    if (scroller == null) {
      return;
    }
    this.attachedScroller = undefined;
    scroller.removeEventListener('wheel', this.handleUserScrollIntent);
    scroller.removeEventListener('touchstart', this.handleUserScrollIntent);
    scroller.removeEventListener('pointerdown', this.handleUserScrollIntent);
    scroller.removeEventListener('keydown', this.handleUserScrollIntent);
  }

  private handleUserScrollIntent = (event: Event): void => {
    if (
      event.type === 'keydown' &&
      !SCROLL_KEYS.has((event as KeyboardEvent).key)
    ) {
      return;
    }
    this.cancel();
  };
}
