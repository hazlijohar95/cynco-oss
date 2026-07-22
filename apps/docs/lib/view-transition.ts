'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useEffect, useLayoutEffect } from 'react';

// useLayoutEffect fires before paint in the browser; during prerender React
// warns on it, so the server side falls back to useEffect (the effect only
// releases a browser-only transition anyway).
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

// Cross-fade between docs routes via the native View Transitions API. The
// browser snapshots the old page when startViewTransition is called and the
// new page when the callback's promise resolves — but the component that
// started the navigation unmounts with the old page, so it can never signal
// "the new route rendered". The resolver parks here at module level and the
// DESTINATION page's copy of this hook flushes it from a pre-paint layout
// effect on mount — exactly the moment the new snapshot should be taken
// (every docs page mounts a fresh DocsSidebar and DocsPagination).
let releaseTransition: (() => void) | null = null;
let releaseTimer = 0;

function flushDocsViewTransition(): void {
  if (releaseTransition === null) {
    return;
  }
  window.clearTimeout(releaseTimer);
  const release = releaseTransition;
  releaseTransition = null;
  release();
}

// Docs links are prefetched by next/link, so the route usually commits
// within a frame or two — but rendering is suppressed while a transition
// waits, so a navigation that never lands (aborted, error boundary) must
// not freeze the page. Generous enough for a cold chunk fetch, short
// enough that a failure just degrades to an instant swap.
const RELEASE_TIMEOUT_MS = 400;

function supportsDocsViewTransition(): boolean {
  return (
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Returns a click handler for docs-route links (sidebar package list,
 * prev/next pagination). When the View Transitions API is available and
 * motion is welcome, it takes over the navigation and wraps router.push in
 * document.startViewTransition; in every other case it declines by NOT
 * calling preventDefault, so next/link performs its normal client
 * navigation — modified clicks (new tab, download) included.
 *
 * The hook also flushes any pending transition on mount, so arriving
 * anywhere in /docs releases the snapshot the departing page left behind.
 */
export function useDocsViewTransition(): (
  event: MouseEvent<HTMLAnchorElement>,
  href: string
) => void {
  const router = useRouter();
  const pathname = usePathname();

  useIsomorphicLayoutEffect(() => {
    flushDocsViewTransition();
  }, [pathname]);

  return (event, href) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      // Same-route clicks change nothing worth animating (and would leave
      // the release waiting on a remount that never happens).
      href === pathname ||
      !supportsDocsViewTransition()
    ) {
      return;
    }
    event.preventDefault();
    document.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          releaseTransition = resolve;
          releaseTimer = window.setTimeout(
            flushDocsViewTransition,
            RELEASE_TIMEOUT_MS
          );
          router.push(href);
        })
    );
  };
}
