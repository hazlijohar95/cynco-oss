import { describe, expect, test } from 'bun:test';

import {
  contrastRatio,
  type CvdKind,
  deltaE2000,
  deltaE2000Lab,
  type Lab,
  parseHex,
  relativeLuminance,
  type Rgb,
  simulateCvd,
} from '../src/color';

// Test-only strict parse: role sets only contain valid hex, so a null here is
// itself a bug worth failing loudly on.
function hex(value: string): Rgb {
  const rgb = parseHex(value);
  if (rgb === null) throw new Error(`not a hex color: ${value}`);
  return rgb;
}

describe('parseHex', () => {
  test('parses #rrggbb', () => {
    expect(parseHex('#1a85d4')).toEqual({ r: 26, g: 133, b: 212 });
    expect(parseHex('#0a0a0a')).toEqual({ r: 10, g: 10, b: 10 });
    expect(parseHex('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('parses shorthand #rgb', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#08c')).toEqual({ r: 0, g: 136, b: 204 });
  });

  test('returns null on malformed input instead of throwing', () => {
    for (const garbage of [
      '',
      '#',
      '#ff',
      '#ffff',
      '#12345',
      '#1234567',
      '#aabbccdd', // alpha channel — no palette color carries one
      '#0a0a0g',
      'ffffff', // missing hash
      'red',
      ' #ffffff',
    ]) {
      expect(parseHex(garbage)).toBeNull();
    }
  });
});

describe('WCAG contrast', () => {
  test('black on white is the maximum 21:1', () => {
    expect(contrastRatio(hex('#000000'), hex('#ffffff'))).toBeCloseTo(21, 5);
  });

  test('identical colors are 1:1', () => {
    expect(contrastRatio(hex('#1a85d4'), hex('#1a85d4'))).toBe(1);
  });

  test('relative luminance endpoints', () => {
    expect(relativeLuminance(hex('#ffffff'))).toBeCloseTo(1, 5);
    expect(relativeLuminance(hex('#000000'))).toBe(0);
  });

  test('known mid-gray pair (#767676 on white is the AA 4.5:1 boundary)', () => {
    // #767676 is the canonical darkest gray that passes 4.5:1 on white.
    const ratio = contrastRatio(hex('#767676'), hex('#ffffff'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.6);
  });
});

describe('CIEDE2000', () => {
  // Published test pairs 1-3 from Sharma, Wu & Dalal (2005), Table 1 — the
  // reference dataset every CIEDE2000 implementation is validated against.
  test('matches the Sharma et al. published test pairs', () => {
    const pairs: { first: Lab; second: Lab; expected: number }[] = [
      {
        first: { l: 50, a: 2.6772, b: -79.7751 },
        second: { l: 50, a: 0, b: -82.7485 },
        expected: 2.0425,
      },
      {
        first: { l: 50, a: 3.1571, b: -77.2803 },
        second: { l: 50, a: 0, b: -82.7485 },
        expected: 2.8615,
      },
      {
        first: { l: 50, a: 2.8361, b: -74.02 },
        second: { l: 50, a: 0, b: -82.7485 },
        expected: 3.4412,
      },
    ];
    for (const { first, second, expected } of pairs) {
      expect(deltaE2000Lab(first, second)).toBeCloseTo(expected, 4);
    }
  });

  test('identical colors have zero difference', () => {
    expect(deltaE2000(hex('#d52c36'), hex('#d52c36'))).toBe(0);
  });

  test('is symmetric', () => {
    const a = hex('#199f43');
    const b = hex('#d52c36');
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 10);
  });
});

describe('CVD simulation (Machado 2009)', () => {
  test('pure red loses red-channel dominance under protanopia', () => {
    // A protanope has no L cones: saturated red collapses to a dim yellowish
    // color whose red and green channels are nearly equal.
    const sim = simulateCvd({ r: 255, g: 0, b: 0 }, 'protanopia');
    expect(sim.r).toBeLessThan(128);
    expect(Math.abs(sim.r - sim.g)).toBeLessThan(32);
  });

  test('red and green collapse under deuteranopia', () => {
    const red = simulateCvd(hex('#d52c36'), 'deuteranopia');
    const green = simulateCvd(hex('#199f43'), 'deuteranopia');
    const before = deltaE2000(hex('#d52c36'), hex('#199f43'));
    const after = deltaE2000(red, green);
    // The confusable axis loses at least half its separation.
    expect(after).toBeLessThan(before * 0.5);
  });

  test('grayscale is a fixed point (every matrix row sums to ~1)', () => {
    const kinds: CvdKind[] = ['protanopia', 'deuteranopia', 'tritanopia'];
    const grays = [0, 10, 128, 188, 255];
    for (const kind of kinds) {
      for (const value of grays) {
        const sim = simulateCvd({ r: value, g: value, b: value }, kind);
        expect(Math.abs(sim.r - value)).toBeLessThanOrEqual(1);
        expect(Math.abs(sim.g - value)).toBeLessThanOrEqual(1);
        expect(Math.abs(sim.b - value)).toBeLessThanOrEqual(1);
      }
    }
  });
});
