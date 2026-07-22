'use client';

import { TableOfContents } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

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
export function DocsLayout({ toc, children }: DocsLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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

  return (
    <>
      <Header className="-mb-[1px]" />
      <main
        id="main"
        className="relative gap-6 pt-6 md:grid md:grid-cols-[220px_1fr] md:gap-12"
      >
        <div className="md:contents">
          <Button
            ref={triggerRef}
            variant="outline"
            size="sm"
            aria-expanded={isMobileMenuOpen}
            aria-controls="docs-sidebar"
            className="text-muted-foreground mb-4 font-mono md:hidden"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <TableOfContents size={14} />
            On this page
          </Button>
          <DocsSidebar
            toc={toc}
            isMobileOpen={isMobileMenuOpen}
            onMobileClose={() => setIsMobileMenuOpen(false)}
          />
        </div>
        {children}
      </main>
    </>
  );
}
