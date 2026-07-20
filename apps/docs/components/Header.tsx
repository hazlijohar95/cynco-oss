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
  { href: '/docs/theming', label: 'Theming' },
  { href: '/playground', label: 'Playground' },
  { href: '/ledger-dev', label: 'Perf lab' },
] as const;

// Cynco's mark: a bold, closed-terminal "C" split by a centered balance bar —
// the ledger zero-line every entry settles on, and the currency stroke of
// finance, nested in the initial. It stays unmistakably a C from 16px favicon
// up, and inherits the current text color so it themes automatically.
//
// `size` is the square glyph edge. `duotone` renders the balance bar at 40%
// opacity, echoing the debit-solid / credit-muted pairing the packages render;
// the default monotone reads cleanest in dense chrome.
export function CyncoMark({
  size = 20,
  duotone = false,
}: {
  size?: number;
  duotone?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10c3.28 0 6.19-1.58 8.01-4.02l-3.2-2.4A6 6 0 1 1 12 6c1.94 0 3.68.92 4.78 2.35l3.2-2.4A9.98 9.98 0 0 0 12 2Z"
      />
      <rect
        x="11"
        y="11"
        width="9"
        height="2"
        rx="1"
        fill="currentColor"
        opacity={duotone ? 0.4 : 1}
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
