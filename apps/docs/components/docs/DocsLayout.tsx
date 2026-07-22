'use client';

import { Search, TableOfContents } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { DocsPagination } from './DocsPagination';
import { DocsSearchDialog } from './DocsSearchDialog';
import { DocsSidebar } from './DocsSidebar';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import type { DocsTocEntry } from '@/lib/docs-toc';

export interface DocsLayoutProps {
  /** Build-time table of contents for the sidebar scroll-spy. */
  toc?: readonly DocsTocEntry[];
  children: ReactNode;
}

// Docs page shell: sticky header on top, 220px sidebar + content grid below.
// The sidebar collapses into the shared mobile popover on small screens,
// opened by the "On this page" trigger and closed by backdrop click, link
// follow, or Escape (which returns focus to the trigger).
//
// The shell also owns the docs search dialog (⌘K / Ctrl+K toggles, '/'
// opens outside text fields) and appends prev/next pagination under the
// content column, so every docs page gets both without wiring anything.
// The content wrapper carries data-pagefind-body: Pagefind indexes only
// marked regions once any page has one, which scopes search to docs prose
// and keeps the landing/playground chrome out of the index.
export function DocsLayout({ toc, children }: DocsLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Prevent body scroll behind the mobile popover.
  useEffect(() => {
    document.body.classList.toggle('overflow-hidden', isMobileMenuOpen);
    return () => document.body.classList.remove('overflow-hidden');
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsMobileMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMobileMenuOpen]);

  // Search shortcuts. ⌘K/Ctrl+K toggles from anywhere (including inside the
  // dialog); '/' only opens, and only when the keystroke doesn't belong to
  // a text field. The dialog owns Escape itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchOpen((open) => !open);
        return;
      }
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select') !== null)
      ) {
        return;
      }
      event.preventDefault();
      setIsSearchOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The dialog and the mobile popover are both modal surfaces; opening one
  // closes the other so focus is never trapped behind a backdrop.
  const openSearch = () => {
    setIsMobileMenuOpen(false);
    setIsSearchOpen(true);
  };

  return (
    <>
      <Header className="-mb-[1px]" />
      <main
        id="main"
        className="relative gap-6 pt-6 md:grid md:grid-cols-[220px_1fr] md:gap-12"
      >
        <div className="md:contents">
          <div className="mb-4 flex gap-2 md:hidden" data-print-hidden>
            <Button
              ref={triggerRef}
              variant="outline"
              size="sm"
              aria-expanded={isMobileMenuOpen}
              aria-controls="docs-sidebar"
              className="text-muted-foreground font-mono"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <TableOfContents size={14} />
              On this page
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground font-mono"
              onClick={openSearch}
            >
              <Search size={14} />
              Search
            </Button>
          </div>
          <DocsSidebar
            toc={toc}
            isMobileOpen={isMobileMenuOpen}
            onMobileClose={() => setIsMobileMenuOpen(false)}
            onSearchOpen={openSearch}
          />
        </div>
        {/* docs-content-vt names this column for the route cross-fade
         * (globals.css): only the content participates in the view
         * transition — the header and sidebar persist, snapshot under the
         * root group, and the root's animation is disabled. */}
        <div className="docs-content-vt min-w-0" data-pagefind-body>
          {children}
          <DocsPagination />
        </div>
      </main>
      <DocsSearchDialog
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </>
  );
}
