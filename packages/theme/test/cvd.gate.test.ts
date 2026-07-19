// OBJECTIVE CVD GATE for the color-vision-deficiency role sets. Every color
// is first recolored the way a full dichromat sees it (Machado 2009,
// severity 1.0), then the gate asserts on the SIMULATED colors:
//   • ΔE₀₀(debit, credit) ≥ 20 — the core ledger semantic must stay clearly
//     distinguishable (ΔE₀₀ > ~10 already reads as "different colors"; 20
//     leaves headroom for rendering and anomalous trichromacy).
//   • ΔE₀₀(states.success, states.danger) ≥ 20 — same bar for the state pair
//     that carries pass/fail meaning.
//   • simulated debit/credit on simulated bg.editor ≥ 3.0 — WCAG SC 1.4.11,
//     because simulation shifts luminance and legibility must survive too.
// The lightCvd/darkCvd sets are gated under BOTH protanopia and deuteranopia;
// the tritan sets under tritanopia.
import { describe, expect, test } from 'bun:test';

import {
  contrastRatio,
  type CvdKind,
  deltaE2000,
  parseHex,
  type Rgb,
  simulateCvd,
} from '../src/color';
import {
  dark,
  darkCvd,
  darkTritan,
  light,
  lightCvd,
  lightTritan,
  type Roles,
} from '../src/roles';

const SAFE_DELTA_E = 20;
const UI_CONTRAST = 3;

// Test-only strict parse: role sets only contain valid hex, so a null here is
// itself a bug worth failing loudly on.
function hex(value: string): Rgb {
  const rgb = parseHex(value);
  if (rgb === null) throw new Error(`not a hex color: ${value}`);
  return rgb;
}

type GateDef = { name: string; roles: Roles; kinds: CvdKind[] };
const GATED_SETS: GateDef[] = [
  { name: 'lightCvd', roles: lightCvd, kinds: ['protanopia', 'deuteranopia'] },
  { name: 'darkCvd', roles: darkCvd, kinds: ['protanopia', 'deuteranopia'] },
  { name: 'lightTritan', roles: lightTritan, kinds: ['tritanopia'] },
  { name: 'darkTritan', roles: darkTritan, kinds: ['tritanopia'] },
];

describe('CVD gate (Machado 2009 simulation, severity 1.0)', () => {
  for (const { name, roles, kinds } of GATED_SETS) {
    for (const kind of kinds) {
      describe(`${name} under ${kind}`, () => {
        const sim = (value: string) => simulateCvd(hex(value), kind);
        const simBg = sim(roles.bg.editor);

        test(`debit vs credit stays separable (ΔE₀₀ >= ${SAFE_DELTA_E})`, () => {
          expect(
            deltaE2000(sim(roles.ledger.debit), sim(roles.ledger.credit))
          ).toBeGreaterThanOrEqual(SAFE_DELTA_E);
        });

        test(`success vs danger stays separable (ΔE₀₀ >= ${SAFE_DELTA_E})`, () => {
          expect(
            deltaE2000(sim(roles.states.success), sim(roles.states.danger))
          ).toBeGreaterThanOrEqual(SAFE_DELTA_E);
        });

        test(`debit stays legible on bg.editor (>= ${UI_CONTRAST}:1)`, () => {
          expect(
            contrastRatio(sim(roles.ledger.debit), simBg)
          ).toBeGreaterThanOrEqual(UI_CONTRAST);
        });

        test(`credit stays legible on bg.editor (>= ${UI_CONTRAST}:1)`, () => {
          expect(
            contrastRatio(sim(roles.ledger.credit), simBg)
          ).toBeGreaterThanOrEqual(UI_CONTRAST);
        });
      });
    }
  }

  // Documented failure of the base themes: this is the evidence that the CVD
  // variants are necessary, not decorative. The base green/red debit/credit
  // pair collapses under deuteranopia (the most common dichromacy) to a
  // fraction of the safe separation — measured ΔE₀₀ ≈ 4.8 (light) and ≈ 4.5
  // (dark), i.e. barely a noticeable difference. If a palette change ever
  // makes the base themes pass, these assertions flag it so the docs (and
  // possibly the variants) can be reconsidered.
  describe('base themes are NOT deuteranopia-safe (documented, expected failure)', () => {
    for (const [name, roles] of [
      ['light', light],
      ['dark', dark],
    ] as [string, Roles][]) {
      test(`${name} debit vs credit collapses under deuteranopia (ΔE₀₀ < ${SAFE_DELTA_E})`, () => {
        const sim = (value: string) => simulateCvd(hex(value), 'deuteranopia');
        expect(
          deltaE2000(sim(roles.ledger.debit), sim(roles.ledger.credit))
        ).toBeLessThan(SAFE_DELTA_E);
      });
    }
  });
});
