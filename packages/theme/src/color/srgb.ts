// sRGB transfer-curve helpers (IEC 61966-2-1). Everything downstream — WCAG
// luminance, CVD simulation, CIEDE2000 — operates in linear light, so these
// two conversions are the shared foundation of src/color.

// Decode an 8-bit sRGB channel (0-255) to linear light (0-1).
export function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Encode a linear-light value (0-1, clamped) back to an 8-bit sRGB channel.
// Clamping matters because CVD matrix rows can push channels slightly out of
// gamut for saturated inputs.
export function linearToSrgb(linear: number): number {
  const clamped = linear < 0 ? 0 : linear > 1 ? 1 : linear;
  const c =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}
