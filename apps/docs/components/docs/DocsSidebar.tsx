'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface HeadingItem {
  id: string;
  text: string;
  element: HTMLElement;
}

const PRODUCT_PAGES = [
  { href: '/docs/journals', label: 'Journals' },
  { href: '/docs/accounts', label: 'Accounts' },
] as const;

const navLinkClass =
  'flex items-center gap-2 px-3 py-[6px] rounded-md text-sm transition-all duration-150 ease-in-out cursor-pointer text-muted-foreground hover:text-foreground';

export interface DocsSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

// Sticky docs sidebar: package pages up top, then a scroll-spied table of
// contents built from the page's `h2[id]` elements. On mobile the same nav
// renders inside the shared popover surface.
export function DocsSidebar({
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Collect the page's h2 ids once after layout; ids are authored directly
  // on the headings in the docs content.
  useLayoutEffect(() => {
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

  // Scroll-spy: the last heading above the 100px line wins.
  useEffect(() => {
    if (headings.length === 0) return undefined;
    const handleScroll = () => {
      for (let i = headings.length - 1; i >= 0; i--) {
        const rect = headings[i].element.getBoundingClientRect();
        if (rect.top <= 100) {
          setActiveHeading(headings[i].id);
          return;
        }
      }
      setActiveHeading(headings[0].id);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [headings]);

  // Keep the active TOC link centered within the scrollable sidebar.
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
      nav.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  }, [activeHeading]);

  return (
    <>
      {isMobileOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <nav
        ref={navRef}
        className={cn('mobile-popover docs-sidebar', isMobileOpen && 'is-open')}
        onClick={onMobileClose}
      >
        <div className="border-border mb-4 border-b pb-4">
          {PRODUCT_PAGES.map(({ href, label }) => (
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
              'mr-[2px]',
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
