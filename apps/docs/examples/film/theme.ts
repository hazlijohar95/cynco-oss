// Film palette, pinned to the site's own tokens (globals.css) so a rendered
// frame is indistinguishable from the live page in either color scheme.
// Remotion renders its own canvas outside the DOM, so it cannot read CSS
// custom properties — the resolved values are duplicated here and selected by
// the `scheme` input prop the Player passes in.

export type FilmScheme = 'light' | 'dark';

export interface FilmPalette {
  background: string;
  foreground: string;
  card: string;
  muted: string;
  border: string;
  borderStrong: string;
  weak: string;
  success: string;
  destructive: string;
}

const LIGHT: FilmPalette = {
  background: '#ffffff',
  foreground: '#161616',
  card: '#fafafa',
  muted: '#5c5c5c',
  border: 'rgba(0, 0, 0, 0.10)',
  borderStrong: 'rgba(0, 0, 0, 0.20)',
  weak: '#6b6b6b',
  success: '#198b43',
  destructive: '#b82d35',
};

const DARK: FilmPalette = {
  background: '#161616',
  foreground: '#ffffff',
  card: '#242424',
  muted: '#d4d4d4',
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.20)',
  weak: '#808080',
  success: '#60d199',
  destructive: '#ff6b6b',
};

export function getFilmPalette(scheme: FilmScheme): FilmPalette {
  return scheme === 'dark' ? DARK : LIGHT;
}

// Paper Mono is the site's brand face; fall back to the same system-mono
// stack globals.css uses so the film reads correctly before the webfont
// loads or when rendered headless.
export const FILM_FONT_FAMILY =
  "var(--font-paper-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
