// Deterministic PRNG for fixture generation. Fixtures must be reproducible
// byte-for-byte across runs, machines, and runtimes — Math.random gives no
// such guarantee — so every generator in this package draws from an
// explicitly seeded mulberry32 stream.

/** A deterministic stream of pseudo-random values from one explicit seed. */
export interface SeededRandom {
  /** Next float in [0, 1), like Math.random but reproducible. */
  next(): number;
  /** Next integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Uniformly picks one item from a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/**
 * Creates a mulberry32 PRNG. Mulberry32 is a tiny (one 32-bit word of
 * state) generator with good statistical quality for fixture purposes and
 * identical output on every JS engine, which is all test data needs.
 */
export function createSeededRandom(seed: number): SeededRandom {
  // Force the seed into uint32 space so fractional or negative seeds still
  // produce a valid deterministic stream.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt(minInclusive: number, maxExclusive: number): number {
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
  };
}
