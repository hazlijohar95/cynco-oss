'use client';

import { useEffect, useState } from 'react';

import type { FilmScheme } from './theme';

// Resolves the scheme the film should paint in, tracking the same signal the
// rest of the site uses: the `light` / `dark` class the theme toggle writes
// on <html>, falling back to the OS preference for class-less (system) loads.
// A MutationObserver keeps the film in step when the toggle flips mid-view,
// so the rendered frames never disagree with the surrounding page.
function readScheme(): FilmScheme {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const root = document.documentElement;
  if (root.classList.contains('dark')) {
    return 'dark';
  }
  if (root.classList.contains('light')) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useFilmScheme(): FilmScheme {
  // Start light on the server and first paint; correct to the real scheme in
  // an effect so SSR markup and hydration agree.
  const [scheme, setScheme] = useState<FilmScheme>('light');

  useEffect(() => {
    setScheme(readScheme());

    const root = document.documentElement;
    const observer = new MutationObserver(() => setScheme(readScheme()));
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => setScheme(readScheme());
    media.addEventListener('change', onMediaChange);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMediaChange);
    };
  }, []);

  return scheme;
}
