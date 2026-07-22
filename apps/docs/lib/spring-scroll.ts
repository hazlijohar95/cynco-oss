'use client';

import { SmoothScroller } from '@cynco/journals';

// Dogfooding: the docs scroll on the same critically-damped spring the
// register ships — @cynco/journals' SmoothScroller, unmodified. Its contract
// is "animate an HTMLElement's scrollTop", and the page qualifies:
// document.scrollingElement is the <html> element in standards mode, whose
// scrollTop drives the window. That element is also where the scroller's
// user-input cancel listeners land, and every wheel / touchstart /
// pointerdown / scroll-key keydown on the page bubbles up through <html>,
// so "the user took over" cancellation works page-wide without adaptation.
// Reduced motion is likewise built in: scrollTo() checks
// prefers-reduced-motion itself and jumps instantly.
//
// One instance per scroll container is the class's own rule (concurrent
// scroll-to calls retarget a single spring instead of two animators
// fighting), hence the module-level singleton.
let pageScroller: SmoothScroller | null = null;

function getPageScrollingElement(): HTMLElement | undefined {
  const scrollingElement = document.scrollingElement;
  return scrollingElement instanceof HTMLElement ? scrollingElement : undefined;
}

function getPageScroller(): SmoothScroller {
  pageScroller ??= new SmoothScroller(getPageScrollingElement);
  return pageScroller;
}

/**
 * Glides the page to `element` on the journals spring. The target is
 * computed the same way the sidebar scroll-spy measures heading offsets —
 * `getBoundingClientRect().top + window.scrollY` — minus the element's own
 * computed scroll-margin-top (5.5rem on prose headings, see prose.css), so
 * the spring settles exactly where a native `#hash` jump would put it and
 * the spy activates the same entry either way.
 */
export function springScrollToElement(element: HTMLElement): void {
  const scrollingElement = getPageScrollingElement();
  if (scrollingElement === undefined) {
    return;
  }
  const parsedMargin = Number.parseFloat(
    getComputedStyle(element).scrollMarginTop
  );
  const scrollMarginTop = Number.isNaN(parsedMargin) ? 0 : parsedMargin;
  const top =
    element.getBoundingClientRect().top + window.scrollY - scrollMarginTop;
  // Clamp to the scrollable range so a target near the document end settles
  // (and releases its cancel listeners) as soon as the real position does.
  const maxTop = scrollingElement.scrollHeight - scrollingElement.clientHeight;
  getPageScroller().scrollTo(Math.max(0, Math.min(top, maxTop)));
}
