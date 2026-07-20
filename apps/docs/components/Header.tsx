'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { CyncoMark } from './CyncoMark';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';
import { GITHUB_URL, SITE_LINKS } from '@/lib/site';
import { cn } from '@/lib/utils';

// Center-nav links in the /data grammar: 13px, muted, no underline, strong
// on hover; the active route reads in the strong tier.
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        'text-muted-foreground hover:text-foreground flex h-8 items-center justify-center px-4 text-[13px] leading-none whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
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
// border on the page background. The mobile menu closes on Escape, on
// pointer-down outside itself, and when a link inside it is followed.
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

  const closeMenu = () => setMenuOpen(false);

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
        className="text-foreground flex flex-none items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label="Accounting by Cynco — home"
      >
        <CyncoMark />
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-semibold">Accounting</span>
          <span className="text-muted-foreground text-[12px]">by Cynco</span>
        </span>
      </Link>

      <nav
        aria-label="Primary"
        className="hidden min-w-0 flex-1 items-center justify-center md:flex"
      >
        <ul className="m-0 flex list-none items-center p-0">
          {SITE_LINKS.map(({ href, label }) => (
            <li key={href}>
              <NavLink href={href} label={label} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="ml-auto flex flex-none items-center gap-2 md:ml-0">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-data btn-data-neutral max-sm:hidden"
        >
          <strong>GitHub</strong>
          <span>[↗]</span>
        </a>
        <Link
          href="/docs/journals"
          className="btn-data btn-data-contrast max-sm:hidden"
        >
          <strong>Get started</strong>
        </Link>
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
        aria-label="Primary"
        ref={menuRef}
        className={cn('mobile-popover md:hidden', menuOpen && 'is-open')}
      >
        <div className="flex flex-col gap-1">
          {SITE_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={closeMenu}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary px-3 py-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            >
              {label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary px-3 py-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            GitHub [↗]
          </a>
        </div>
      </nav>
    </header>
  );
}
