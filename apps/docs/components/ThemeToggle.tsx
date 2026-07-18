'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from './ui/button';

type ResolvedTheme = 'light' | 'dark';

// Navbar tint (iOS Safari's <meta name="theme-color">) per resolved mode.
// These match the page --background values and the literals hardcoded in the
// layout's pre-paint bootstrap script (which can't import this module).
const MODE_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#161616',
};

function readResolvedTheme(): ResolvedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

// Points the document's theme-color meta at `color`, creating the meta if it
// isn't there yet. Kept imperative (not JSX) so exactly one meta exists,
// shared with the bootstrap script.
function setThemeColorMeta(color: string) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta == null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

// Sun/moon toggle that flips the html class + color-scheme + navbar tint and
// persists the explicit choice. The pre-paint bootstrap in layout.tsx reads
// the same localStorage key, so there is never a flash of the wrong mode.
export function ThemeToggle() {
  const [theme, setTheme] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    setTheme(readResolvedTheme());
  }, []);

  const toggle = () => {
    const next: ResolvedTheme =
      readResolvedTheme() === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(next);
    root.style.colorScheme = next;
    setThemeColorMeta(MODE_THEME_COLOR[next]);
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      // Private-mode storage failures only lose persistence, not the toggle.
    }
    setTheme(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
    </Button>
  );
}
