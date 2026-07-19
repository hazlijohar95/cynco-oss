# Accessibility

## Color-vision-deficiency (CVD) role sets

`@cynco/theme` ships four role sets engineered for people with a color vision
deficiency, alongside the four base sets:

| Export        | Base    | Safe for                              | Semantic axis     |
| ------------- | ------- | ------------------------------------- | ----------------- |
| `lightCvd`    | `light` | protanopia & deuteranopia (red-green) | blue ↔ orange     |
| `darkCvd`     | `dark`  | protanopia & deuteranopia (red-green) | blue ↔ orange     |
| `lightTritan` | `light` | tritanopia (blue-yellow)              | teal ↔ vermillion |
| `darkTritan`  | `dark`  | tritanopia (blue-yellow)              | teal ↔ vermillion |

### Why the base themes fail

The base `ledger` role group maps debit to green and credit to red (mirror diff
semantics). Protanopia (missing L cones) and deuteranopia (missing M cones) —
together the large majority of CVD, which affects roughly 8% of men and 0.5% of
women — collapse exactly that red ↔ green axis. Measured with the Machado et al.
(2009) severity-1.0 simulation and CIEDE2000:

- `light` debit vs credit: ΔE₀₀ 72.8 normally → **4.8** under deuteranopia.
- `dark` debit vs credit: ΔE₀₀ 69.1 normally → **4.5** under deuteranopia.

ΔE₀₀ ≈ 2–3 is "just noticeable"; a deuteranope reading the base themes cannot
reliably tell a debit from a credit, a success from a danger, or reconciled from
flagged. `test/cvd.gate.test.ts` asserts this failure permanently so the
variants are provably necessary, not decorative.

### How the variants are engineered

- **Chrome is untouched.** `bg`, `fg`, `border`, and `accent` are identical to
  the base `light`/`dark` sets — only semantic colors (`states`, `ledger`) move,
  so the variants still look like Cynco.
- **Signals ride the preserved axis.** Protanopia/deuteranopia preserve blue ↔
  orange (plus luminance), so `lightCvd`/`darkCvd` map debit/success to the
  `blue` ramp and credit/danger to the `orange` ramp. Tritanopia preserves red ↔
  cyan/teal, so the tritan sets map debit/success to `teal` and credit/danger to
  `vermillion`.
- **Every hue comes from `palettes`.** No off-ramp hex was invented; the
  variants only re-select steps from the existing scales.

### What the test gate guarantees

`test/cvd.gate.test.ts` simulates every gated color at full dichromacy (Machado,
Oliveira & Fernandes 2009, applied in linear RGB) and asserts on the simulated
colors — `lightCvd`/`darkCvd` under both protanopia and deuteranopia, the tritan
sets under tritanopia:

- ΔE₀₀(debit, credit) ≥ 20 — measured 47.4–54.5 (CVD sets), 59.6–63.8 (tritan
  sets).
- ΔE₀₀(states.success, states.danger) ≥ 20 — measured 47.4–61.6 and 59.6–69.0.
- Simulated debit/credit contrast on the simulated `bg.editor` ≥ 3.0 (WCAG SC
  1.4.11) — measured 4.16–10.91.

`test/contrast.gate.test.ts` additionally holds **all eight** role sets to WCAG
floors on `bg.editor`: `fg.base` ≥ 7.0 (AAA body text), `fg.fg2` ≥ 4.5 (AA
normal text), and every `states.*`/`ledger.*` token ≥ 3.0 (UI graphics / large
text). The four CVD sets meet every floor outright; a handful of pre-existing
base-theme tokens (caution yellows, de-emphasized `void`) are pinned at their
measured values as documented debt so they cannot regress further.

`test/color.test.ts` validates the science itself: CIEDE2000 against the Sharma,
Wu & Dalal (2005) published test pairs, WCAG contrast endpoints, and the Machado
matrix invariants (grayscale fixed points, red-green collapse).
