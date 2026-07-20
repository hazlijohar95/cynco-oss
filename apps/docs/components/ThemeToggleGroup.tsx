'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  applyPreference,
  readPreference,
  subscribeTheme,
  type ThemePreference,
} from '@/lib/theme';

const PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  dark: 'Dark theme',
  light: 'Light theme',
  system: 'Follow system theme',
};

function PreferenceIcon({ preference }: { preference: ThemePreference }) {
  if (preference === 'dark') return <Moon size={12} aria-hidden="true" />;
  if (preference === 'light') return <Sun size={12} aria-hidden="true" />;
  return <Monitor size={12} aria-hidden="true" />;
}

// The /data footer theme control: a three-option dark/light/system strip on
// a layer-2 background where the active option gets the page background and
// a micro shadow ring. All reads/writes go through lib/theme, and the strip
// subscribes to the shared channel so the header toggle (and other tabs)
// can't leave its pressed state stale.
export function ThemeToggleGroup() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    const sync = () => setPreference(readPreference());
    sync();
    return subscribeTheme(sync);
  }, []);

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
          onClick={() => applyPreference(option)}
        >
          <PreferenceIcon preference={option} />
        </button>
      ))}
    </div>
  );
}
