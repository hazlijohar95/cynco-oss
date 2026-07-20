'use client';

import dynamic from 'next/dynamic';

import { useInViewOnce } from '../useInViewOnce';
import { type FilmScheme, getFilmPalette } from './theme';
import { useFilmScheme } from './useFilmScheme';

// Poster-first embed of the ledger film. Remotion (Player, Thumbnail, and
// the 700-line composition) is code-split behind next/dynamic AND deferred
// until the section nears the viewport, so the home page's initial bundle
// pays nothing for it: before the stage loads, a palette-matched
// placeholder with the play chip stands in. A single click plays it — no
// autoplay, matching the restrained, demo-first page.
const LedgerFilmStage = dynamic(() => import('./LedgerFilmStage'), {
  ssr: false,
  loading: () => <FilmLoadingPoster />,
});

export function LedgerFilmPlayer() {
  const scheme = useFilmScheme();
  const palette = getFilmPalette(scheme);
  const { ref, inView } = useInViewOnce<HTMLDivElement>('300px');

  return (
    <div
      ref={ref}
      className="demo-container relative aspect-video w-full"
      style={{ backgroundColor: palette.background }}
    >
      {inView ? <LedgerFilmStage scheme={scheme} /> : <FilmLoadingPoster />}
    </div>
  );
}

// The pre-Remotion stand-in: the film's background with a non-interactive
// loading chip in the same spot the play chip will occupy.
function FilmLoadingPoster() {
  const scheme = useFilmScheme();
  return (
    <div className="absolute inset-0" style={{ cursor: 'progress' }}>
      <FilmPlayChip scheme={scheme} label="Loading…" />
    </div>
  );
}

// The centered chip shared by the loading poster and the stage's real play
// button: a dimmed overlay wash with a glossy pill carrying the play glyph.
export function FilmPlayChip({
  scheme,
  label,
}: {
  scheme: FilmScheme;
  label: string;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <span
      className="absolute inset-0 flex items-center justify-center"
      style={{
        backgroundColor:
          scheme === 'dark' ? 'rgba(22,22,22,0.28)' : 'rgba(255,255,255,0.28)',
      }}
    >
      <span
        className="flex items-center gap-3 px-4 py-2 text-sm font-medium transition-transform group-hover:scale-[1.03]"
        style={{
          backgroundColor: palette.background,
          color: palette.foreground,
          boxShadow: `0 0 0 0.5px ${palette.borderStrong}, 0 1px 2px -1px rgba(0,0,0,0.25)`,
        }}
      >
        <PlayGlyph color={palette.foreground} />
        {label}
      </span>
    </span>
  );
}

function PlayGlyph({ color }: { color: string }) {
  return (
    <svg width={11} height={12} viewBox="0 0 11 12" aria-hidden="true">
      <path d="M0 0L11 6L0 12Z" fill={color} />
    </svg>
  );
}
