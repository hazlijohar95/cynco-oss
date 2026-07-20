'use client';

import { Player, type PlayerRef, Thumbnail } from '@remotion/player';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FILM_DURATION,
  FILM_FPS,
  FILM_HEIGHT,
  FILM_POSTER_FRAME,
  FILM_WIDTH,
  LedgerFilm,
} from './LedgerFilm';
import { FilmPlayChip } from './LedgerFilmPlayer';
import type { FilmScheme } from './theme';

export interface LedgerFilmStageProps {
  scheme: FilmScheme;
}

// Everything that needs Remotion lives here, behind LedgerFilmPlayer's
// next/dynamic import, so the ~400 KB player chunk downloads only when the
// film section approaches the viewport. Before playback a <Thumbnail>
// poster shows the composition's balanced frame; a click swaps in the
// Player. If the user scrolls away mid-playback, the film pauses so an
// off-screen composition never keeps painting frames.
export default function LedgerFilmStage({ scheme }: LedgerFilmStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const [started, setStarted] = useState(false);

  const play = useCallback(() => {
    setStarted(true);
    // Let the Player mount on this tick, then start from the top.
    requestAnimationFrame(() => {
      playerRef.current?.seekTo(0);
      playerRef.current?.play();
    });
  }, []);

  useEffect(() => {
    if (!started) return;
    const node = containerRef.current;
    if (node == null || typeof IntersectionObserver === 'undefined') return;
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
  }, [started]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {started ? (
        <Player
          ref={playerRef}
          component={LedgerFilm}
          inputProps={{ scheme }}
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
        <button
          type="button"
          onClick={play}
          aria-label="Play the Cynco ledger film"
          className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ border: 0, padding: 0 }}
        >
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
          <FilmPlayChip scheme={scheme} label="Play the ledger film" />
        </button>
      )}
    </div>
  );
}
