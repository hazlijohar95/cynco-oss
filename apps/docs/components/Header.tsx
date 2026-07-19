'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export const GITHUB_URL = 'https://github.com/hazlijohar95/cynco-oss';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs/journals', label: 'Journals' },
  { href: '/docs/accounts', label: 'Accounts' },
  { href: '/playground', label: 'Playground' },
] as const;

// Cynco's own two-tone ledger glyph: a solid journal page beside a
// 40%-opacity account column, echoing the debit/credit pairing the packages
// render. `size` is the glyph height; the mark is twice as wide.
export function CyncoMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size * 2}
      height={size}
      viewBox="0 0 32 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentcolor"
        d="M15.5 16H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3h12.5v16ZM5 4a1 1 0 0 0 0 2h5.5a1 1 0 1 0 0-2H5Zm0 3.5a1 1 0 0 0 0 2h5.5a1 1 0 1 0 0-2H5ZM5 11a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2H5Z"
      />
      <path
        fill="currentcolor"
        d="M29 0a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H16.5V0H29Zm-8.5 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1Zm7 3a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm-3.5-1.5a1 1 0 0 0-1 1V11a1 1 0 1 0 2 0V6.5a1 1 0 0 0-1-1Z"
        opacity=".4"
      />
    </svg>
  );
}

// Center-nav links in the /data grammar: 13px, muted, no underline, strong
// on hover; the active route reads in the strong tier.
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        'text-muted-foreground hover:text-foreground flex h-8 items-center justify-center px-[15px] text-[13px] leading-none whitespace-nowrap',
        isActive && 'text-foreground pointer-events-none'
      )}
    >
      {label}
    </Link>
  );
}

export interface HeaderProps {
  className?: string;
}

// Sticky site header in the opencode /data style: brand glyph + wordmark on
// the left, 13px section nav in the middle, glossy neutral/contrast button
// pair plus the theme toggle on the right, all over a hairline bottom
// border on the page background. The mobile menu closes on Escape and on
// pointer-down outside itself.
export function Header({ className }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    // The toggle button is excluded so its own click handler owns the flip
    // (otherwise pointerdown-close + click-toggle would reopen the menu).
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) === true) return;
      if (menuButtonRef.current?.contains(target) === true) return;
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  return (
    <header
      data-slot="header"
      className={cn(
        'bg-background border-border sticky top-0 z-40 -mx-5 flex min-h-[64px] items-center gap-4 border-b bg-clip-padding px-5 font-mono md:mx-0 md:min-h-[72px] md:px-0',
        className
      )}
    >
      <a
        href="#main"
        className="focus-visible:outline-ring focus-visible:bg-background sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:outline-2"
      >
        Skip to content
      </a>
      <Link
        href="/"
        className="text-foreground flex flex-none items-center gap-2.5"
        aria-label="Cynco home"
      >
        <CyncoMark />
        <span className="text-[15px] leading-none font-semibold">cynco</span>
      </Link>

      <nav className="hidden min-w-0 flex-1 items-center justify-center md:flex">
        <ul className="m-0 flex list-none items-center p-0">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <NavLink href={href} label={label} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="ml-auto flex flex-none items-center gap-2 md:ml-0">
        {/* Wrapper (not `hidden` on the buttons themselves) because the
         * unlayered .btn-data display rule outranks layered utilities. */}
        <div className="hidden items-center gap-2 sm:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-data btn-data-neutral"
          >
            <strong>GitHub</strong>
            <span>[↗]</span>
          </a>
          <Link href="/docs/journals" className="btn-data btn-data-contrast">
            <strong>Get started</strong>
          </Link>
        </div>
        <ThemeToggle />
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="site-mobile-menu"
          className="md:hidden"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu size={16} />
        </Button>
      </div>

      <nav
        id="site-mobile-menu"
        ref={menuRef}
        className={cn('mobile-popover md:hidden', menuOpen && 'is-open')}
        onClick={() => setMenuOpen(false)}
      >
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary px-3 py-2 text-[13px] transition-colors"
            >
              {label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground hover:bg-secondary px-3 py-2 text-[13px] transition-colors"
          >
            GitHub [↗]
          </a>
        </div>
      </nav>
    </header>
  );
}
