'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { DocsSidebar } from './DocsSidebar';
import { Header } from '@/components/Header';

export interface DocsLayoutProps {
  children: ReactNode;
}

// Docs page shell: sticky header on top, 220px sidebar + content grid below.
// The sidebar collapses into the shared mobile popover on small screens.
export function DocsLayout({ children }: DocsLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Prevent body scroll behind the mobile popover.
  useEffect(() => {
    document.body.classList.toggle('overflow-hidden', isMobileMenuOpen);
    return () => document.body.classList.remove('overflow-hidden');
  }, [isMobileMenuOpen]);

  return (
    <>
      <Header className="-mb-[1px]" />
      <div className="relative gap-6 pt-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <DocsSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={() => setIsMobileMenuOpen(false)}
        />
        {children}
      </div>
    </>
  );
}
