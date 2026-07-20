# @cynco/theme

npm: [`@cynco/theme`](https://www.npmjs.com/package/@cynco/theme) · used by the
role sets documented at <https://ledger.cynco.dev/docs/theming>

Cynco theme: color palettes and semantic roles for ledger UIs, from
[Cynco](https://github.com/hazlijohar95/cynco-oss) — modern accounting
infrastructure. Consumed by `@cynco/journals` and `@cynco/accounts` as their
default theme layer.

Palette ramps are derived from the MIT-licensed
[@pierre/theme](https://github.com/pierrecomputer/pierre) palettes by the Pierre
Computer Company; the `ledger` role group is Cynco's financial-domain extension.

```ts
import { dark, themeToCSSVariables } from '@cynco/theme';

const style = themeToCSSVariables('journals', dark);
// { '--journals-theme-bg-editor': '#0a0a0a', ... }
```

## Roles

- `bg` / `fg` / `border` / `accent` — window chrome, strictly achromatic.
- `states` — match / success / danger / warn / info.
- `ledger` — financial semantics: `debit` and `credit` mirror diff added and
  deleted colors, plus tokens for dates, payees, accounts, currencies, tags,
  links, and reconciliation status.

## Role sets

- `light` / `dark` and the contrast-compressed `lightSoft` / `darkSoft`.
- `lightCvd` / `darkCvd` — safe for protanopia and deuteranopia (red-green color
  vision deficiency): debit/credit ride a blue ↔ orange axis.
- `lightTritan` / `darkTritan` — safe for tritanopia: debit/credit ride a teal ↔
  vermillion axis.

The CVD sets are enforced by an objective test gate (Machado 2009 simulation,
CIEDE2000 separation, WCAG contrast) — see [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Color science

Pure, dependency-free helpers used by the gate and exported for consumers:
`parseHex` (null on malformed input), `srgbToLinear` / `linearToSrgb`,
`relativeLuminance` / `contrastRatio` (WCAG 2.x), `simulateCvd` (Machado et al.
2009 dichromacy simulation), and `deltaE2000` / `deltaE2000Lab` (CIEDE2000).
