import type { Rgb } from './Rgb';
import { srgbToLinear } from './srgb';

// WCAG 2.x relative luminance: the Y (luma) of the color in linear light,
// weighted by the sRGB primaries' contribution to perceived brightness.
// This is the channel CVD users rely on most, so the gates lean on it.
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * srgbToLinear(rgb.r) +
    0.7152 * srgbToLinear(rgb.g) +
    0.0722 * srgbToLinear(rgb.b)
  );
}

// WCAG 2.x contrast ratio, order-independent: (lighter + 0.05) / (darker +
// 0.05), ranging 1:1 (identical) to 21:1 (black on white). AA thresholds the
// gates use: 4.5:1 normal text (SC 1.4.3), 3:1 large text / UI graphics
// (SC 1.4.11), 7:1 AAA body text (SC 1.4.6).
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
