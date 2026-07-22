'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { DocsTocEntry } from '@/lib/docs-toc';
import { DOCS_LINKS } from '@/lib/site';
import { cn } from '@/lib/utils';

// useLayoutEffect fires before paint in the browser; during prerender React
// warns on it, so the server side falls back to useEffect (the effect only
// touches document APIs anyway).
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

// Sidebar/TOC links transition color-only: font-weight is toggled by the
// active state and must snap — tweening weight on a variable font reflows
// the glyphs every frame.
const navLinkClass =
  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-[color,background-color] duration-150 cursor-pointer text-muted-foreground hover:text-foreground';

/** One measurable TOC row: the h3 rows carry their nesting depth. */
interface FlatTocItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

// The nested build-time TOC, flattened into document order for the
// scroll-spy sweep (h3s always follow their h2).
function flattenToc(toc: readonly DocsTocEntry[]): FlatTocItem[] {
  const items: FlatTocItem[] = [];
  for (const entry of toc) {
    items.push({ id: entry.id, text: entry.text, depth: 2 });
    for (const child of entry.children) {
      items.push({ id: child.id, text: child.text, depth: 3 });
    }
  }
  return items;
}

export interface DocsSidebarProps {
  /** Build-time table of contents exported by the page's MDX module. */
  toc?: readonly DocsTocEntry[];
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

// Sticky docs sidebar: package pages up top, then a scroll-spied table of
// contents. Headings arrive as build-time data extracted from the MDX
// sources (lib/mdx/rehype-docs.mjs) — the DOM is only touched to measure
// offsets, never to discover content. On mobile the same nav renders inside
// the shared popover surface, opened by DocsLayout's "On this page" trigger.
export function DocsSidebar({
  toc = [],
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Absolute document offsets per heading, precomputed so the scroll
  // handler never reads layout. Refreshed when headings or viewport change.
  const headingTopsRef = useRef<number[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Memoized so the measurement effect keys on the data, not on a fresh
  // array identity per render (which would tear down and re-add the scroll
  // listeners on every spy update).
  const headings = useMemo(() => flattenToc(toc), [toc]);

  // Restore the deep-link scroll position after layout and seed the active
  // heading; the heading list itself is static per page.
  useIsomorphicLayoutEffect(() => {
    if (headings.length > 0 && window.location.hash.trim() === '') {
      setActiveHeading(headings[0].id);
    }
    if (window.location.hash.trim() !== '') {
      const element = document.getElementById(window.location.hash.slice(1));
      element?.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }, [pathname, headings]);

  // Scroll-spy: the last heading above the 100px line wins. Offsets are
  // measured once per headings/resize change (one batched read pass), and
  // the scroll handler is rAF-gated so flick scrolling costs at most one
  // comparison sweep per frame — no layout reads, no thrash.
  useEffect(() => {
    if (headings.length === 0) return undefined;

    const measure = () => {
      headingTopsRef.current = headings.map((heading) => {
        const element = document.getElementById(heading.id);
        if (element === null) return Number.POSITIVE_INFINITY;
        return element.getBoundingClientRect().top + window.scrollY;
      });
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.scrollY + 100;
      const tops = headingTopsRef.current;
      let active = headings[0].id;
      for (let i = tops.length - 1; i >= 0; i--) {
        if (tops[i] <= line) {
          active = headings[i].id;
          break;
        }
      }
      setActiveHeading(active);
    };
    const handleScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(update);
    };
    const handleResize = () => {
      measure();
      handleScroll();
    };

    measure();
    update();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    // Font swaps or hydrating demos can shift the offsets without a
    // viewport resize; watching the body height keeps them honest.
    const bodyObserver = new ResizeObserver(handleResize);
    bodyObserver.observe(document.body);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      bodyObserver.disconnect();
    };
  }, [headings]);

  // Keep the active TOC link centered within the scrollable sidebar. The
  // glide is a programmatic scroll, which the global reduced-motion CSS
  // can't reach, so it is gated here explicitly.
  useEffect(() => {
    const nav = navRef.current;
    if (activeHeading === '' || nav == null) return;
    const activeLink = nav.querySelector(
      `a[href="#${CSS.escape(activeHeading)}"]`
    );
    if (activeLink instanceof HTMLElement) {
      const scrollTarget =
        activeLink.offsetTop -
        nav.clientHeight / 2 +
        activeLink.offsetHeight / 2;
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      nav.scrollTo({
        top: scrollTarget,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
  }, [activeHeading]);

  return (
    <>
      {/* Always mounted so the declared fade actually runs both ways;
       * pointer-events gate replaces conditional mounting. */}
      <div
        aria-hidden="true"
        className={cn(
          'bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden',
          isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onMobileClose}
      />

      <nav
        id="docs-sidebar"
        ref={navRef}
        aria-label="On this page"
        className={cn(
          'mobile-popover docs-sidebar font-mono',
          isMobileOpen && 'is-open'
        )}
        onClick={onMobileClose}
      >
        <div className="border-border mb-4 border-b pb-4">
          {DOCS_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                navLinkClass,
                // The index route would prefix-match every docs page.
                (href === '/docs'
                  ? pathname === href
                  : pathname.startsWith(href)) &&
                  'text-foreground bg-muted font-medium'
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={cn(
              navLinkClass,
              // 2px of clearance between the hover pill and the scrollbar.
              'mr-0.5',
              heading.depth === 3 && 'pl-6',
              activeHeading === heading.id &&
                'text-foreground bg-muted font-medium'
            )}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </>
  );
}
