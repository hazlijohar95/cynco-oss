'use client';

import { Github, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export const GITHUB_URL = 'https://github.com/cyncohq/cynco-ledger';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs/journals', label: 'Journals' },
  { href: '/docs/accounts', label: 'Accounts' },
  { href: '/playground', label: 'Playground' },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        'text-muted-foreground gap-0.5 px-2 font-normal',
        isActive && 'text-foreground pointer-events-none font-medium'
      )}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}

export interface HeaderProps {
  className?: string;
}

// Sticky site header: Cynco lockup + muted tagline on the left, ghost-button
// nav + GitHub + theme toggle on the right. A hairline border fades in via
// the `.is-stuck` class once the page scrolls.
export function Header({ className }: HeaderProps) {
  const [isStuck, setIsStuck] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let lastStuck: boolean | undefined;
    const handleScroll = () => {
      const stuck = window.scrollY > 0;
      if (stuck !== lastStuck) {
        lastStuck = stuck;
        setIsStuck(stuck);
      }
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      data-slot="header"
      className={cn(
        'bg-background sticky top-0 z-40 -mx-5 flex items-center justify-between gap-4 bg-clip-padding px-5 py-3 transition-[border-color,box-shadow] duration-200 md:mx-0 md:px-0',
        isStuck ? 'is-stuck' : 'border-b border-transparent',
        className
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <Link
          href="/"
          className="text-foreground hover:text-foreground/80 text-lg leading-[20px] font-semibold transition-colors"
        >
          Cynco
        </Link>
        <span className="text-muted-foreground hidden text-sm leading-[20px] md:inline">
          Ledger primitives for the web
        </span>
      </div>

      <div className="mr-auto flex items-center md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu size={16} />
        </Button>
      </div>

      <nav
        className={cn('mobile-popover md:hidden', menuOpen && 'is-open')}
        onClick={() => setMenuOpen(false)}
      >
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-[6px] text-sm transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <nav className="flex items-center">
        <div className="hidden items-center md:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <NavLink key={href} href={href} label={label} />
          ))}
          <div className="border-border mx-2 h-5 w-px border-l" />
        </div>
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <Github size={16} />
          </Link>
        </Button>
        <ThemeToggle />
      </nav>
    </header>
  );
}
