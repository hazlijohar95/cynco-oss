import {
  AbsoluteFill,
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

// Frame budget (30fps): post the entry, prove it balances, roll it into the
// chart of accounts, hold. Kept in one place so the Player duration and the
// scene offsets below stay in sync.
export const FILM_FPS = 30;
export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;
const POST_SCENE = 132; // ~4.4s: postings type in
const BALANCE_SCENE = 96; // ~3.2s: sum ticks to zero
const ROLLUP_SCENE = 132; // ~4.4s: tree builds
const HOLD = 30; // ~1s tail
export const FILM_DURATION = POST_SCENE + BALANCE_SCENE + ROLLUP_SCENE + HOLD;

// Poster frame: the balanced moment — every posting is in (the last appears
// at 12 + 4*18 = 84) and the sum has settled to 0.00, which is the film's
// strongest still and sells the product before the first click.
export const FILM_POSTER_FRAME = 118;
export interface LedgerFilmProps {
  scheme: FilmScheme;
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
      <Sequence durationInFrames={POST_SCENE + BALANCE_SCENE}>
        <PostAndBalanceScene scheme={scheme} />
      </Sequence>
      <Sequence from={POST_SCENE + BALANCE_SCENE}>
        <RollupScene scheme={scheme} />
      </Sequence>
      <Watermark scheme={scheme} />
    </AbsoluteFill>
  );
}

// --- Scene 1 + 2: post the entry, then balance it -------------------------

function PostAndBalanceScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Sum of every posting revealed so far, in sen. The running total is the
  // real integer sum, so the number the viewer watches settle is the same
  // value isEntryBalanced() checks against zero.
  const revealed = FILM_POSTINGS.filter((_, index) => {
    const appearAt = 12 + index * 18;
    return frame >= appearAt;
  });
  const runningTotal = revealed.reduce(
    (total, posting) => total + posting.amount,
    0
  );

  const balanced =
    revealed.length === FILM_POSTINGS.length && runningTotal === 0;
  const balancePulse = balanced
    ? spring({
        frame: frame - (12 + FILM_POSTINGS.length * 18),
        fps,
        config: { damping: 14, mass: 0.6 },
      })
    : 0;

  return (
    <AbsoluteFill
      style={{
        padding: 72,
        justifyContent: 'center',
      }}
    >
      <SceneLabel scheme={scheme} index="01" text="Post" />
      <div
        style={{
          border: `1px solid ${palette.border}`,
          backgroundColor: palette.card,
          maxWidth: 940,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <EntryHeader scheme={scheme} />
        <div style={{ padding: '8px 0' }}>
          {FILM_POSTINGS.map((posting, index) => {
            const appearAt = 12 + index * 18;
            const local = frame - appearAt;
            const opacity = interpolate(local, [0, 10], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const slide = interpolate(local, [0, 10], [8, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <PostingRow
                key={posting.account}
                scheme={scheme}
                account={posting.account}
                amount={posting.amount}
                style={{ opacity, transform: `translateY(${slide}px)` }}
              />
            );
          })}
        </div>
        <BalanceBar
          scheme={scheme}
          total={runningTotal}
          balanced={balanced}
          pulse={balancePulse}
        />
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: roll up into the chart of accounts --------------------------

function RollupScene({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const intro = spring({ frame, fps, config: { damping: 18 } });

  return (
    <AbsoluteFill style={{ padding: 72, justifyContent: 'center' }}>
      <SceneLabel scheme={scheme} index="02" text="Roll up" />
      <div
        style={{
          border: `1px solid ${palette.border}`,
          backgroundColor: palette.card,
          maxWidth: 940,
          width: '100%',
          alignSelf: 'center',
          opacity: intro,
          transform: `translateY(${interpolate(intro, [0, 1], [12, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: `1px solid ${palette.border}`,
            fontSize: 15,
            color: palette.weak,
          }}
        >
          <span>Chart of accounts</span>
          <span>Rolled balance</span>
        </div>
        <div style={{ padding: '8px 0' }}>
          {FILM_TREE.map((row, index) => {
            const appearAt = 8 + index * 9;
            const local = frame - appearAt;
            const opacity = interpolate(local, [0, 8], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const slide = interpolate(local, [0, 8], [6, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <TreeRow
                key={row.path}
                scheme={scheme}
                label={row.label}
                depth={row.depth}
                rolled={row.rolled}
                kind={row.kind}
                style={{ opacity, transform: `translateY(${slide}px)` }}
              />
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// --- Pieces ---------------------------------------------------------------

function SceneLabel({
  scheme,
  index,
  text,
}: {
  scheme: FilmScheme;
  index: string;
  text: string;
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
      }}
    >
      <span style={{ color: palette.weak }}>{index}</span>
      <span style={{ color: palette.foreground, fontWeight: 500 }}>{text}</span>
      <span
        aria-hidden
        style={{ flex: 1, height: 1, backgroundColor: palette.border }}
      />
    </div>
  );
}

function EntryHeader({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '16px 24px',
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 500 }}>July payroll run</span>
      <span style={{ fontSize: 15, color: palette.weak }}>2026-07-25</span>
    </div>
  );
}

function PostingRow({
  scheme,
  account,
  amount,
  style,
}: {
  scheme: FilmScheme;
  account: string;
  amount: number;
  style?: React.CSSProperties;
}) {
  const palette = getFilmPalette(scheme);
  const isDebit = amount >= 0;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 24px',
        fontSize: 17,
        ...style,
      }}
    >
      <span style={{ color: palette.foreground }}>{account}</span>
      <span
        style={{
          display: 'flex',
          gap: 20,
          color: isDebit ? palette.foreground : palette.muted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ width: 130, textAlign: 'right' }}>
          {isDebit ? formatMinorUnits(amount) : ''}
        </span>
        <span style={{ width: 130, textAlign: 'right' }}>
          {isDebit ? '' : formatMinorUnits(-amount)}
        </span>
      </span>
    </div>
  );
}

function BalanceBar({
  scheme,
  total,
  balanced,
  pulse,
}: {
  scheme: FilmScheme;
  total: number;
  balanced: boolean;
  pulse: number;
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
        padding: '16px 24px',
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
            transform: `scale(${balanced ? 1 + pulse * 0.6 : 1})`,
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
  kind,
  style,
}: {
  scheme: FilmScheme;
  label: string;
  depth: number;
  rolled: number;
  kind: 'group' | 'leaf';
  style?: React.CSSProperties;
}) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 24px',
        paddingLeft: 24 + depth * 28,
        fontSize: 17,
        ...style,
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
        {formatMinorUnits(rolled)}
      </span>
    </div>
  );
}

function Watermark({ scheme }: { scheme: FilmScheme }) {
  const palette = getFilmPalette(scheme);
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        bottom: 40,
        fontSize: 14,
        letterSpacing: '0.02em',
        color: palette.weak,
      }}
    >
      cynco · integer minor units · balances by construction
    </div>
  );
}
