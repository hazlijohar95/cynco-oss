'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DOCS_LINKS } from '@/lib/site';
import { cn } from '@/lib/utils';

const cardClass =
  'group border-border hover:bg-muted flex flex-col gap-1 rounded-md border px-4 py-3 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px]';

// Prev/next pagination under every docs page, rendered by DocsLayout so no
// page wires it by hand. The sequence is DOCS_LINKS — the index first, then
// the packages in reading order — the same contract the sidebar and the
// /docs index render from, so the order can't drift between surfaces.
// Excluded from the search index (it repeats page titles on every page) and
// from print (paper can't click).
export function DocsPagination() {
  const pathname = usePathname();
  const index = DOCS_LINKS.findIndex(({ href }) => href === pathname);
  if (index === -1) return null;

  const previous = index > 0 ? DOCS_LINKS[index - 1] : null;
  const next = index < DOCS_LINKS.length - 1 ? DOCS_LINKS[index + 1] : null;
  if (previous === null && next === null) return null;

  return (
    <nav
      aria-label="Documentation pages"
      data-pagefind-ignore
      data-print-hidden
      className="border-border mt-12 grid grid-cols-2 gap-3 border-t pt-4 font-mono"
    >
      {previous !== null && (
        <Link href={previous.href} className={cn(cardClass, 'col-start-1')}>
          <span className="text-text-weak text-[11px]">Previous</span>
          <span className="text-muted-foreground group-hover:text-foreground text-sm font-medium transition-colors duration-150">
            {previous.label}
          </span>
        </Link>
      )}
      {next !== null && (
        <Link
          href={next.href}
          className={cn(cardClass, 'col-start-2 items-end text-right')}
        >
          <span className="text-text-weak text-[11px]">Next</span>
          <span className="text-muted-foreground group-hover:text-foreground text-sm font-medium transition-colors duration-150">
            {next.label}
          </span>
        </Link>
      )}
    </nav>
  );
}
