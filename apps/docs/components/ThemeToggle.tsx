'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from './ui/button';
import {
  applyPreference,
  readPreference,
  type ResolvedTheme,
  resolveTheme,
  subscribeTheme,
} from '@/lib/theme';

// Sun/moon toggle that flips to the opposite of the currently resolved mode
// and persists the explicit choice through lib/theme. The icon pair is
// CSS-driven (`dark:` variants), so the correct glyph paints from the very
// first frame with no hydration flash; React state only feeds the
// accessible label. Subscribes to the shared theme channel so the footer
// strip, other tabs, and OS flips keep this control honest.
export function ThemeToggle() {
  const [resolved, setResolved] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    const sync = () => setResolved(resolveTheme(readPreference()));
    sync();
    return subscribeTheme(sync);
  }, []);

  const toggle = () => {
    applyPreference(
      resolveTheme(readPreference()) === 'dark' ? 'light' : 'dark'
    );
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        resolved == null
          ? 'Toggle theme'
          : resolved === 'dark'
            ? 'Switch to light theme'
            : 'Switch to dark theme'
      }
    >
      <Sun size={16} className="dark:hidden" />
      <Moon size={16} className="hidden dark:block" />
    </Button>
  );
}
