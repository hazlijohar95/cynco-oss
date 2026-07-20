'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { DOCS_LINKS } from '@/lib/site';
import { cn } from '@/lib/utils';

interface HeadingItem {
  id: string;
  text: string;
  element: HTMLElement;
}

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

export interface DocsSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

// Sticky docs sidebar: package pages up top, then a scroll-spied table of
// contents built from the page's `h2[id]` elements. On mobile the same nav
// renders inside the shared popover surface, opened by DocsLayout's
// "On this page" trigger.
export function DocsSidebar({
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Absolute document offsets per heading, precomputed so the scroll
  // handler never reads layout. Refreshed when headings or viewport change.
  const headingTopsRef = useRef<number[]>([]);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Collect the page's h2 ids once after layout; ids are authored directly
  // on the headings in the docs content.
  useIsomorphicLayoutEffect(() => {
    const headingElements = document.querySelectorAll('h2[id]');
    const items: HeadingItem[] = [];
    for (const element of headingElements) {
      if (!(element instanceof HTMLElement)) continue;
      items.push({
        id: element.id,
        text: element.textContent ?? '',
        element,
      });
    }
    setHeadings(items);

    if (items.length > 0 && window.location.hash.trim() === '') {
      setActiveHeading(items[0].id);
    }
    if (window.location.hash.trim() !== '') {
      const element = document.getElementById(window.location.hash.slice(1));
      element?.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }, [pathname]);

  // Scroll-spy: the last heading above the 100px line wins. Offsets are
  // measured once per headings/resize change (one batched read pass), and
  // the scroll handler is rAF-gated so flick scrolling costs at most one
  // comparison sweep per frame — no layout reads, no thrash.
  useEffect(() => {
    if (headings.length === 0) return undefined;

    const measure = () => {
      headingTopsRef.current = headings.map(
        (heading) =>
          heading.element.getBoundingClientRect().top + window.scrollY
      );
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
                pathname.startsWith(href) &&
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
