import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  FILM_CURRENCY,
  FILM_POSTINGS,
  FILM_TREE,
  formatMinorUnits,
} from './data';
import { FILM_FONT_FAMILY, type FilmScheme, getFilmPalette } from './theme';

// A short film with a real timeline (30fps). Scenes overlap by CROSSFADE_FRAMES
// so cuts dissolve rather than snap, and every reveal rides an ease-out-expo
// curve — the confident, decelerating motion that reads as cinematic instead
// of mechanical. Total ~28s.
export const FILM_FPS = 30;
export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;

const TITLE_SCENE = 108; // 3.6s cold open
const POST_SCENE = 216; // 7.2s: entry builds, amounts count up
const BALANCE_SCENE = 168; // 5.6s: sum counts to zero, the payoff, held
const ROLLUP_SCENE = 216; // 7.2s: postings flow into the tree
const CLOSE_SCENE = 132; // 4.4s: pull back, tagline, hold
const CROSSFADE = 24; // 0.8s dissolve between scenes

export const FILM_DURATION =
  TITLE_SCENE +
  POST_SCENE +
  BALANCE_SCENE +
  ROLLUP_SCENE +
  CLOSE_SCENE -
  CROSSFADE * 4;

// Scene start frames on the master timeline (each overlaps the previous by
// one crossfade so the outgoing scene is still fading as the next enters).
const AT_TITLE = 0;
const AT_POST = TITLE_SCENE - CROSSFADE;
const AT_BALANCE = AT_POST + POST_SCENE - CROSSFADE;
const AT_ROLLUP = AT_BALANCE + BALANCE_SCENE - CROSSFADE;
const AT_CLOSE = AT_ROLLUP + ROLLUP_SCENE - CROSSFADE;

// Poster frame: the balanced payoff, deep into the balance scene, where the
// sum has settled on 0.00 and the entry is fully built.
export const FILM_POSTER_FRAME = AT_BALANCE + 96;

// The confident deceleration curve from the motion guidelines
// (cubic-bezier(0.16, 1, 0.3, 1)) — used for every entrance.
const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_OUT_QUINT = Easing.bezier(0.22, 1, 0.36, 1);

export interface LedgerFilmProps {
  scheme: FilmScheme;
}

// Eased 0→1 ramp starting at `delay` over `duration` frames.
function reveal(frame: number, delay: number, duration: number): number {
  return interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_EXPO,
  });
}

export function LedgerFilm({ scheme }: LedgerFilmProps) {
  const palette = getFilmPalette(scheme);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.background,
        color: palette.foreground,
        fontFamily: FILM_FONT_FAMILY,
        fontFeatureSettings: '"tnum" 1',
      }}
    >
      <CrossfadeScene from={AT_TITLE} durationInFrames={TITLE_SCENE}>
        <TitleScene scheme={scheme} />
      </CrossfadeScene>
      <CrossfadeScene from={AT_POST} durationInFrames={POST_SCENE}>
        <PostScene scheme={scheme} />
      </CrossfadeScene>
      <CrossfadeScene from={AT_BALANCE} durationInFrames={BALANCE_SCENE}>
        <BalanceScene scheme={scheme} />
      </CrossfadeScene>
      <CrossfadeScene from={AT_ROLLUP} durationInFrames={ROLLUP_SCENE}>
        <RollupScene scheme={scheme} />
      </CrossfadeScene>
      <CrossfadeScene from={AT_CLOSE} durationInFrames={CLOSE_SCENE}>
        <CloseScene scheme={scheme} />
      </CrossfadeScene>
      <Watermark scheme={scheme} />
    </AbsoluteFill>
  );
}

// Wraps a scene in a Sequence and fades it in/out over CROSSFADE frames so
// neighbouring scenes dissolve into one another instead of hard-cutting.
function CrossfadeScene({
  from,
  durationInFrames,
  children,
}: {
  from: number;
  durationInFrames: number;
  children: React.ReactNode;
}) {
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      <CrossfadeInner durationInFrames={durationInFrames}>
        {children}
      </CrossfadeInner>
    </Sequence>
  );
}

function CrossfadeInner({
  durationInFrames,
  children,
}: {
  durationInFrames: number;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, CROSSFADE, durationInFrames - CROSSFADE, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

// --- Cold open ------------------------------------------------------------

function TitleScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();

  const titleY = interpolate(reveal(frame, 6, 40), [0, 1], [18, 0]);
  const titleOpacity = reveal(frame, 6, 40);
  const ruleScale = reveal(frame, 20, 46); // hairline draws across
  const subOpacity = reveal(frame, 34, 40);
  // Gentle push-in on the whole title as it settles.
  const groupScale = interpolate(reveal(frame, 0, 90), [0, 1], [1.04, 1]);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${groupScale})`,
      }}
    >
      <div style={{ width: 940, maxWidth: '100%' }}>
        <div
          style={{
            fontSize: 46,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          A ledger, in motion
        </div>
        <div
          aria-hidden
          style={{
            height: 1,
            marginTop: 24,
            backgroundColor: palette.foreground,
            transform: `scaleX(${ruleScale})`,
            transformOrigin: 'left center',
          }}
        />
        <div
          style={{
            marginTop: 20,
            fontSize: 19,
            color: palette.muted,
            opacity: subOpacity,
          }}
        >
          Integer minor units. Balanced by construction.
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- Post: the entry builds, amounts count up -----------------------------

function PostScene({ scheme }: { scheme: FilmScheme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Card rises and scales in, with a slow camera push over the whole scene.
  const cardIn = spring({ frame, fps, config: { damping: 200, mass: 1.1 } });
  const cardY = interpolate(cardIn, [0, 1], [40, 0]);
  const cardScale = interpolate(cardIn, [0, 1], [0.96, 1]);
  const push = interpolate(frame, [0, POST_SCENE], [1, 1.03], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  const rowStart = 40;
  const rowStagger = 26;

  return (
    <AbsoluteFill style={{ padding: 72, justifyContent: 'center' }}>
      <SceneLabel
        scheme={scheme}
        index="01"
        text="Post"
        reveal={reveal(frame, 8, 36)}
      />
      <Card
        scheme={scheme}
        style={{
          opacity: cardIn,
          transform: `translateY(${cardY}px) scale(${cardScale * push})`,
        }}
      >
        <EntryHeader scheme={scheme} reveal={reveal(frame, 18, 30)} />
        <div style={{ padding: '10px 0' }}>
          {FILM_POSTINGS.map((posting, index) => {
            const delay = rowStart + index * rowStagger;
            const r = reveal(frame, delay, 30);
            // Count the amount up from zero as the row settles.
            const shown = Math.round(posting.amount * r);
            return (
              <PostingRow
                key={posting.account}
                scheme={scheme}
                account={posting.account}
                amount={posting.amount}
                shownAmount={shown}
                reveal={r}
              />
            );
          })}
        </div>
      </Card>
    </AbsoluteFill>
  );
}

// --- Balance: the sum counts to zero, the payoff --------------------------

function BalanceScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The entry is fully present here; a faint push keeps it alive.
  const push = interpolate(frame, [0, BALANCE_SCENE], [1.03, 1.05], {
    extrapolateRight: 'clamp',
  });

  // The running sum counts DOWN from its pre-balance residual to exactly 0,
  // then the balance bar flips to green with a spring pop.
  const countProgress = interpolate(frame, [10, 70], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_QUINT,
  });
  const residual = FILM_POSTINGS.slice(0, -1).reduce(
    (sum, p) => sum + p.amount,
    0
  );
  const shownTotal = Math.round(residual * (1 - countProgress));
  const balanced = frame >= 70;
  const pop = spring({
    frame: frame - 70,
    fps,
    config: { damping: 12, mass: 0.7 },
  });
  const glow = balanced
    ? interpolate(frame, [70, 100], [0, 1], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <AbsoluteFill style={{ padding: 72, justifyContent: 'center' }}>
      <SceneLabel scheme={scheme} index="01" text="Post" reveal={1} />
      <Card
        scheme={scheme}
        style={{ transform: `scale(${push})` }}
        glow={glow > 0 ? palette.success : undefined}
        glowStrength={glow}
      >
        <EntryHeader scheme={scheme} reveal={1} />
        <div style={{ padding: '10px 0' }}>
          {FILM_POSTINGS.map((posting) => (
            <PostingRow
              key={posting.account}
              scheme={scheme}
              account={posting.account}
              amount={posting.amount}
              shownAmount={posting.amount}
              reveal={1}
            />
          ))}
        </div>
        <BalanceBar
          scheme={scheme}
          total={balanced ? 0 : shownTotal}
          balanced={balanced}
          pop={balanced ? pop : 0}
        />
      </Card>
    </AbsoluteFill>
  );
}

// --- Roll up: postings flow into the chart of accounts --------------------

function RollupScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardIn = spring({ frame, fps, config: { damping: 200 } });
  const push = interpolate(frame, [0, ROLLUP_SCENE], [0.98, 1.02], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  const rowStart = 30;
  const rowStagger = 16;

  return (
    <AbsoluteFill style={{ padding: 72, justifyContent: 'center' }}>
      <SceneLabel
        scheme={scheme}
        index="02"
        text="Roll up"
        reveal={reveal(frame, 6, 34)}
      />
      <Card
        scheme={scheme}
        style={{
          opacity: cardIn,
          transform: `translateY(${interpolate(cardIn, [0, 1], [28, 0])}px) scale(${push})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '18px 28px',
            borderBottom: `1px solid ${palette.border}`,
            fontSize: 15,
            color: palette.weak,
            opacity: reveal(frame, 16, 28),
          }}
        >
          <span>Chart of accounts</span>
          <span>Rolled balance</span>
        </div>
        <div style={{ padding: '10px 0' }}>
          {FILM_TREE.map((row, index) => {
            const delay = rowStart + index * rowStagger;
            const r = reveal(frame, delay, 30);
            const shownRolled = Math.round(row.rolled * r);
            return (
              <TreeRow
                key={row.path}
                scheme={scheme}
                label={row.label}
                depth={row.depth}
                rolled={row.rolled}
                shownRolled={shownRolled}
                kind={row.kind}
                reveal={r}
              />
            );
          })}
        </div>
      </Card>
    </AbsoluteFill>
  );
}

// --- Close: pull back, tagline, hold --------------------------------------

function CloseScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();

  const wordmarkOpacity = reveal(frame, 8, 40);
  const wordmarkY = interpolate(reveal(frame, 8, 44), [0, 1], [16, 0]);
  const ruleScale = reveal(frame, 22, 46);
  const lineOpacity = reveal(frame, 34, 40);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 940, maxWidth: '100%', textAlign: 'left' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            opacity: wordmarkOpacity,
            transform: `translateY(${wordmarkY}px)`,
          }}
        >
          <span style={{ fontSize: 40 }}>Accounting</span>
          <span style={{ fontSize: 22, color: palette.muted }}>by Cynco</span>
        </div>
        <div
          aria-hidden
          style={{
            height: 1,
            marginTop: 20,
            backgroundColor: palette.foreground,
            transform: `scaleX(${ruleScale})`,
            transformOrigin: 'left center',
          }}
        />
        <div
          style={{
            marginTop: 18,
            fontSize: 18,
            color: palette.muted,
            opacity: lineOpacity,
          }}
        >
          Integer minor units. Balanced by construction.
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- Pieces ---------------------------------------------------------------

function Card({
  scheme,
  style,
  glow,
  glowStrength = 0,
  children,
}: {
  scheme: FilmScheme;
  style?: React.CSSProperties;
  glow?: string;
  glowStrength?: number;
  children: React.ReactNode;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.card,
        maxWidth: 940,
        width: '100%',
        alignSelf: 'center',
        boxShadow: glow
          ? `0 0 0 1px ${glow}${Math.round(glowStrength * 90)
              .toString(16)
              .padStart(2, '0')}, 0 20px 60px -20px ${glow}55`
          : '0 20px 60px -30px rgba(0,0,0,0.35)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SceneLabel({
  scheme,
  index,
  text,
  reveal: r,
}: {
  scheme: FilmScheme;
  index: string;
  text: string;
  reveal: number;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 24,
        maxWidth: 940,
        width: '100%',
        alignSelf: 'center',
        fontSize: 15,
        opacity: r,
        transform: `translateY(${interpolate(r, [0, 1], [8, 0])}px)`,
      }}
    >
      <span style={{ color: palette.weak }}>{index}</span>
      <span style={{ color: palette.foreground, fontWeight: 500 }}>{text}</span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          backgroundColor: palette.border,
          transform: `scaleX(${r})`,
          transformOrigin: 'left center',
        }}
      />
    </div>
  );
}

function EntryHeader({
  scheme,
  reveal: r,
}: {
  scheme: FilmScheme;
  reveal: number;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '18px 28px',
        borderBottom: `1px solid ${palette.border}`,
        opacity: r,
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 500 }}>July payroll run</span>
      <span style={{ fontSize: 15, color: palette.weak }}>2026-07-25</span>
    </div>
  );
}

function PostingRow({
  scheme,
  account,
  amount,
  shownAmount,
  reveal: r,
}: {
  scheme: FilmScheme;
  account: string;
  amount: number;
  shownAmount: number;
  reveal: number;
}) {
  const palette = getFilmPalette(scheme);
  const isDebit = amount >= 0;
  // Each row slides up and fades as it settles; a faint left accent sweeps in.
  const y = interpolate(r, [0, 1], [10, 0]);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 28px',
        fontSize: 17,
        opacity: r,
        transform: `translateY(${y}px)`,
      }}
    >
      <span style={{ color: palette.foreground }}>{account}</span>
      <span
        style={{
          display: 'flex',
          gap: 24,
          color: isDebit ? palette.foreground : palette.muted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ width: 140, textAlign: 'right' }}>
          {isDebit ? formatMinorUnits(shownAmount) : ''}
        </span>
        <span style={{ width: 140, textAlign: 'right' }}>
          {isDebit ? '' : formatMinorUnits(-shownAmount)}
        </span>
      </span>
    </div>
  );
}

function BalanceBar({
  scheme,
  total,
  balanced,
  pop,
}: {
  scheme: FilmScheme;
  total: number;
  balanced: boolean;
  pop: number;
}) {
  const palette = getFilmPalette(scheme);
  const color = balanced
    ? palette.success
    : total === 0
      ? palette.weak
      : palette.destructive;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '18px 28px',
        borderTop: `1px solid ${palette.border}`,
        fontSize: 16,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color,
          fontWeight: 500,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 9,
            height: 9,
            backgroundColor: color,
            transform: `scale(${balanced ? 1 + pop * 0.7 : 1})`,
          }}
        />
        {balanced ? 'Balances' : 'Sum per currency'}
      </span>
      <span
        style={{
          color,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
        }}
      >
        {formatMinorUnits(total)} {FILM_CURRENCY}
      </span>
    </div>
  );
}

function TreeRow({
  scheme,
  label,
  depth,
  rolled,
  shownRolled,
  kind,
  reveal: r,
}: {
  scheme: FilmScheme;
  label: string;
  depth: number;
  rolled: number;
  shownRolled: number;
  kind: 'group' | 'leaf';
  reveal: number;
}) {
  const palette = getFilmPalette(scheme);
  const x = interpolate(r, [0, 1], [-8, 0]);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 28px',
        paddingLeft: 28 + depth * 30,
        fontSize: 17,
        opacity: r,
        transform: `translateX(${x}px)`,
      }}
    >
      <span
        style={{
          color: palette.foreground,
          fontWeight: kind === 'group' ? 500 : 400,
        }}
      >
        {kind === 'group' ? '▾ ' : ''}
        {label}
      </span>
      <span
        style={{
          color: rolled >= 0 ? palette.foreground : palette.muted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatMinorUnits(shownRolled)}
      </span>
    </div>
  );
}

function Watermark({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();
  // Fade the watermark in after the cold open and hold it the rest of the way.
  const opacity = interpolate(
    frame,
    [TITLE_SCENE - CROSSFADE, TITLE_SCENE],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        bottom: 40,
        fontSize: 14,
        letterSpacing: '0.02em',
        color: palette.weak,
        opacity,
      }}
    >
      Accounting by Cynco · integer minor units · balances by construction
    </div>
  );
}
