'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type ThemePreference = 'dark' | 'light' | 'system';

const PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  dark: 'Dark theme',
  light: 'Light theme',
  system: 'Follow system theme',
};

// Navbar tint per resolved mode; mirrors the layout bootstrap script and
// ThemeToggle literals.
const MODE_THEME_COLOR = {
  light: '#ffffff',
  dark: '#161616',
} as const;

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyPreference(preference: ThemePreference) {
  const resolved =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta == null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', MODE_THEME_COLOR[resolved]);

  try {
    window.localStorage.setItem('theme', preference);
  } catch {
    // Private-mode storage failures only lose persistence.
  }
}

function PreferenceIcon({ preference }: { preference: ThemePreference }) {
  if (preference === 'dark') return <Moon size={12} aria-hidden="true" />;
  if (preference === 'light') return <Sun size={12} aria-hidden="true" />;
  return <Monitor size={12} aria-hidden="true" />;
}

// The /data footer theme control: a three-option dark/light/system strip on
// a layer-2 background where the active option gets the page background and
// a micro shadow ring. Shares the `theme` localStorage key with the header
// toggle and the pre-paint bootstrap in layout.tsx.
export function ThemeToggleGroup() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(readPreference());
  }, []);

  const select = (next: ThemePreference) => {
    applyPreference(next);
    setPreference(next);
  };

  return (
    <div className="theme-toggle-group" role="group" aria-label="Theme">
      {PREFERENCES.map((option) => (
        <button
          key={option}
          type="button"
          className="theme-toggle-option"
          aria-label={PREFERENCE_LABEL[option]}
          title={PREFERENCE_LABEL[option]}
          aria-pressed={preference === option ? 'true' : 'false'}
          onClick={() => select(option)}
        >
          <PreferenceIcon preference={option} />
        </button>
      ))}
    </div>
  );
}
