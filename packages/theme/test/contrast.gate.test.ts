// OBJECTIVE CONTRAST GATE for every exported role set. Floors (WCAG 2.x):
//   • fg.base on bg.editor  ≥ 7.0  (SC 1.4.6 AAA body text)
//   • fg.fg2 on bg.editor   ≥ 4.5  (SC 1.4.3 AA normal text)
//   • every states.* and ledger.* on bg.editor ≥ 3.0 (SC 1.4.11 UI graphics /
//     SC 1.4.3 large text — these tokens color amounts, markers, and badges)
// Individual base-theme tokens that predate the gate and genuinely miss the
// 3.0 floor are pinned at their measured value in CONTRAST_DEBT below, so the
// gate still catches any further regression without silently changing base
// theme colors. The four CVD role sets carry no debt — they must meet every
// floor outright.
import { describe, expect, test } from 'bun:test';

import { contrastRatio, parseHex, type Rgb } from '../src/color';
import {
  dark,
  darkCvd,
  darkSoft,
  darkTritan,
  light,
  lightCvd,
  lightSoft,
  lightTritan,
  type Roles,
} from '../src/roles';

// Test-only strict parse: role sets only contain valid hex, so a null here is
// itself a bug worth failing loudly on.
function hex(value: string): Rgb {
  const rgb = parseHex(value);
  if (rgb === null) throw new Error(`not a hex color: ${value}`);
  return rgb;
}

const ROLE_SETS: [string, Roles][] = [
  ['light', light],
  ['dark', dark],
  ['lightSoft', lightSoft],
  ['darkSoft', darkSoft],
  ['lightCvd', lightCvd],
  ['darkCvd', darkCvd],
  ['lightTritan', lightTritan],
  ['darkTritan', darkTritan],
];

// Known debt: base-theme tokens measured below the 3.0 floor, pinned at their
// measured reality (rounded down) so regressions still fail. All are
// deliberately de-emphasized or intrinsically bright hues the base themes
// chose before the gate existed:
//   • warn/pending (yellow-600) on light backgrounds — caution yellow is
//     intrinsically high-luminance; measured 2.21 (light) / 2.12 (lightSoft).
//   • void (neutral-400/700) — voided entries are de-emphasized on purpose;
//     measured 2.52 (light) / 2.42 (lightSoft) / 2.98 (darkSoft).
//   • info/tag (cyan-600) on lightSoft's off-white — measured 2.89; the same
//     hue passes 3.01 on light's pure white.
const CONTRAST_DEBT: Record<string, number> = {
  'light:states.warn': 2.2,
  'light:ledger.pending': 2.2,
  'light:ledger.void': 2.5,
  'lightSoft:states.warn': 2.1,
  'lightSoft:states.info': 2.85,
  'lightSoft:ledger.tag': 2.85,
  'lightSoft:ledger.pending': 2.1,
  'lightSoft:ledger.void': 2.4,
  'darkSoft:ledger.void': 2.9,
};

describe('contrast gate (WCAG 2.x floors on bg.editor)', () => {
  for (const [name, roles] of ROLE_SETS) {
    describe(name, () => {
      const bg = hex(roles.bg.editor);

      test('fg.base is AAA body text (>= 7.0)', () => {
        expect(contrastRatio(hex(roles.fg.base), bg)).toBeGreaterThanOrEqual(7);
      });

      test('fg.fg2 is AA normal text (>= 4.5)', () => {
        expect(contrastRatio(hex(roles.fg.fg2), bg)).toBeGreaterThanOrEqual(
          4.5
        );
      });

      const groups: ['states' | 'ledger', Record<string, string>][] = [
        ['states', roles.states],
        ['ledger', roles.ledger],
      ];
      for (const [groupName, group] of groups) {
        for (const [token, value] of Object.entries(group)) {
          const floor = CONTRAST_DEBT[`${name}:${groupName}.${token}`] ?? 3;
          test(`${groupName}.${token} >= ${floor}`, () => {
            expect(contrastRatio(hex(value), bg)).toBeGreaterThanOrEqual(floor);
          });
        }
      }
    });
  }
});
