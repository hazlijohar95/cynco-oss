'use client';

import { Player, type PlayerRef, Thumbnail } from '@remotion/player';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useInViewOnce } from '../useInViewOnce';
import {
  FILM_DURATION,
  FILM_FPS,
  FILM_HEIGHT,
  FILM_POSTER_FRAME,
  FILM_WIDTH,
  LedgerFilm,
} from './LedgerFilm';
import { type FilmScheme, getFilmPalette } from './theme';
import { useFilmScheme } from './useFilmScheme';

// Poster-first embed of the ledger film. The heavy Player only mounts once
// the section nears the viewport (useInViewOnce); before that a static poster
// stands in, so the page's initial load never pays for Remotion. A single
// click plays it — no autoplay, matching the restrained, demo-first page.
export function LedgerFilmPlayer() {
  const scheme = useFilmScheme();
  const palette = getFilmPalette(scheme);
  const { ref, inView } = useInViewOnce<HTMLDivElement>('300px');
  const playerRef = useRef<PlayerRef>(null);
  const [started, setStarted] = useState(false);

  const inputProps = { scheme };

  const play = useCallback(() => {
    setStarted(true);
    // Let the Player mount on this tick, then start from the top.
    requestAnimationFrame(() => {
      playerRef.current?.seekTo(0);
      playerRef.current?.play();
    });
  }, []);

  // If the user scrolls away, pause so an off-screen film never keeps
  // painting frames.
  useEffect(() => {
    if (!started) {
      return;
    }
    const node = ref.current;
    if (node == null || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            playerRef.current?.pause();
          }
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started, ref]);

  return (
    <div
      ref={ref}
      className="demo-container relative aspect-video w-full"
      style={{ backgroundColor: palette.background }}
    >
      {inView && started ? (
        <Player
          ref={playerRef}
          component={LedgerFilm}
          inputProps={inputProps}
          durationInFrames={FILM_DURATION}
          fps={FILM_FPS}
          compositionWidth={FILM_WIDTH}
          compositionHeight={FILM_HEIGHT}
          style={{ width: '100%', height: '100%' }}
          controls
          loop
          clickToPlay
          spaceKeyToPlayOrPause
          acknowledgeRemotionLicense
          initiallyShowControls={2000}
        />
      ) : (
        <FilmPoster scheme={scheme} onPlay={play} ready={inView} />
      )}
    </div>
  );
}

// The still shown before playback: a real frame of the composition at the
// balanced moment (FILM_POSTER_FRAME), rendered with Remotion's <Thumbnail>
// so it is pixel-identical to what the film shows there — a posted entry
// that sums to exactly 0.00. A play affordance sits on top. Until the section
// is in view, only the framed placeholder shows (Thumbnail is deferred with
// the Player so first load pays for neither).
function FilmPoster({
  scheme,
  onPlay,
  ready,
}: {
  scheme: FilmScheme;
  onPlay: () => void;
  ready: boolean;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <button
      type="button"
      onClick={ready ? onPlay : undefined}
      aria-label="Play the Cynco ledger film"
      className="group absolute inset-0 h-full w-full"
      style={{ cursor: ready ? 'pointer' : 'progress', border: 0, padding: 0 }}
    >
      {ready ? (
        <Thumbnail
          component={LedgerFilm}
          inputProps={{ scheme }}
          durationInFrames={FILM_DURATION}
          fps={FILM_FPS}
          compositionWidth={FILM_WIDTH}
          compositionHeight={FILM_HEIGHT}
          frameToDisplay={FILM_POSTER_FRAME}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: palette.background }}
        />
      )}
      <div
        className="absolute inset-0 flex items-center justify-center transition-colors"
        style={{
          backgroundColor:
            scheme === 'dark'
              ? 'rgba(22,22,22,0.28)'
              : 'rgba(255,255,255,0.28)',
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
          {ready ? 'Play the ledger film' : 'Loading…'}
        </span>
      </div>
    </button>
  );
}

function PlayGlyph({ color }: { color: string }) {
  return (
    <svg width={11} height={12} viewBox="0 0 11 12" aria-hidden="true">
      <path d="M0 0L11 6L0 12Z" fill={color} />
    </svg>
  );
}
