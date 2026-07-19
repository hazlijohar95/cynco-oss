import type { Rgb } from './Rgb';

// Parses a hex color (`#rgb` or `#rrggbb` — the only two forms the palettes
// and role sets use; none carry an alpha channel) into 0-255 channels.
// Returns null on malformed input instead of throwing, per the repo rule that
// parsers degrade gracefully.
export function parseHex(hex: string): Rgb | null {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    return null;
  }
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex.slice(1);
  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
