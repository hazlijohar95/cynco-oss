import type { Rgb } from './Rgb';
import { linearToSrgb, srgbToLinear } from './srgb';

// The three dichromacies (complete forms of color vision deficiency):
// protanopia (missing L/red cones) and deuteranopia (missing M/green cones)
// both collapse red <-> green and preserve a blue <-> orange/yellow axis;
// tritanopia (missing S/blue cones) collapses blue <-> green and preserves a
// red <-> cyan/teal axis. Luminance survives in all three.
export type CvdKind = 'protanopia' | 'deuteranopia' | 'tritanopia';

// Row-major 3x3 matrix applied to a linear-RGB column vector.
type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// Severity-1.0 (full dichromacy) simulation matrices from Machado, Oliveira &
// Fernandes (2009), "A Physiologically-Based Model for Simulation of Color
// Vision Deficiency", IEEE Transactions on Visualization and Computer
// Graphics 15(6). Gating at full severity means anything that survives also
// works for the milder (and more common) anomalous trichromacies. Each row
// sums to ~1.0, so neutral grays are fixed points — a transcription check the
// unit tests exploit.
const MACHADO_SEVERITY_1: Record<CvdKind, Matrix3> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
};

// Simulate how a color appears to a viewer with the given dichromacy, per the
// Machado et al. 2009 model above. The matrix is applied in LINEAR RGB
// (decode gamma, multiply, re-encode) because the RGB->LMS step the model
// approximates lives in linear light. The objective gates in test/ compare
// the simulated outputs, never the originals.
export function simulateCvd(rgb: Rgb, kind: CvdKind): Rgb {
  const m = MACHADO_SEVERITY_1[kind];
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return {
    r: linearToSrgb(m[0] * r + m[1] * g + m[2] * b),
    g: linearToSrgb(m[3] * r + m[4] * g + m[5] * b),
    b: linearToSrgb(m[6] * r + m[7] * g + m[8] * b),
  };
}
