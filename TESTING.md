# Testing

Index of the testing story across the monorepo. The per-package documents hold
the substance — including the candid known-gaps audits:

- [`packages/journals/test/README.md`](packages/journals/test/README.md)
- [`packages/accounts/test/README.md`](packages/accounts/test/README.md)
- [`packages/ledger-core/test/README.md`](packages/ledger-core/test/README.md)

For benchmarks and browser profiling, see [`PERFORMANCE.md`](PERFORMANCE.md).

## Verification baseline

From `AGENTS.md`: after code changes, run `moon run root:format root:lint` plus
the affected typecheck and focused tests for the changed area
(`moonx <project>:typecheck`, `moonx <project>:test`, or
`moonx :typecheck --affected`). Set `AGENT=1` in every shell so bun's test
runner emits agent-friendly output.

## Layers

- **Unit** (`moonx <project>:test`, inherited `bun test` from
  `.moon/tasks/bun-common.yml`, dependency dists built first): bun + jsdom with
  stubbed scroll geometry for the DOM packages, pure-data assertions for
  `ledger-core`, `theme`, and `theming`. Behavioral projections over snapshots;
  the only snapshots are one full-fidelity canary per pure renderer (three in
  journals, one in accounts).
- **E2e** (`moonx journals:test-e2e`, `moonx accounts:test-e2e`): Playwright
  Chromium (self-installing via `check-playwright-binary.ts`) against the
  **built dist**. Each package's Playwright `webServer` starts a Vite server
  rooted at the package; static fixture pages under `test/e2e/fixtures/` import
  `/dist/...` exactly as a consumer would, expose `window.__*` readouts, and
  raise a ready flag the specs await. E2e owns everything jsdom cannot do: real
  scrolling and sticky positioning, trusted input, computed styles, shadow style
  isolation, font measurement, and a real module worker.
- **Visual regression** (`moonx journals:test-vrt`, `moonx accounts:test-vrt`):
  never in CI; see below.
- **Benchmarks** (`moonx <project>:benchmark`): never in CI; see
  `PERFORMANCE.md`.

## Visual regression (VRT)

Playwright `toHaveScreenshot` suites (`test/e2e/visual.vrt.ts`, own config
`test/e2e/playwright.vrt.config.ts`, dedicated fixture
`test/e2e/fixtures/vrt.html`) protect the pixel craft the functional lanes
cannot: focus rings, empty states, density modes, sticky headers, and
reconciliation verdict states — each subject captured in **both** color schemes,
since `light-dark()` theming is a core feature.

- **journals** (9 subjects × light/dark = 18 shots): register in comfortable and
  compact density, register empty state, grouped register with the sticky period
  label engaged mid-scroll, journal entry card balanced and flagged+unbalanced
  (imbalance bar), reconciliation with proposed matches, reconciliation after
  accept + reject verdicts, and the entry diff for a modified entry.
- **accounts** (7 subjects × light/dark = 14 shots): tree in default, compact,
  and relaxed density, selected + focused ring treatments, sticky ancestor
  header engaged mid-scroll, child-load loading placeholder row, and the
  child-load error + Retry row.

Determinism is enforced, not hoped for: fixed 1280×800 viewport with
`deviceScaleFactor: 1`, `reducedMotion: 'reduce'` (the packages' own
`prefers-reduced-motion` rules neutralize transitions at the source),
`colorScheme` pinned per shot via `page.emulateMedia`, deterministic
index-derived fixture data, and every capture waits for `document.fonts.ready`
plus a settled double-rAF. Nothing is masked. Comparison allows
`maxDiffPixelRatio: 0.001` — enough to absorb sub-pixel anti-aliasing jitter
across Chromium point releases, far too small to hide real drift.

**Baselines are per-platform.** Font rasterization differs per OS, so baselines
live under `test/e2e/__screenshots__/{platform}/` and only darwin baselines are
committed. On another platform the first run fails with Playwright's "snapshot
doesn't exist" error (and writes the local baseline); that is the expected
signal, not a bug. For the same reason the VRT tasks are local-only:
`runInCI: 'always'` with zero graph edges (the root `moon.yml` header
convention), so they can never join the CI pipeline.

**Updating baselines** must be an intentional act:

```sh
VRT_UPDATE_SNAPSHOTS=1 moonx journals:test-vrt
VRT_UPDATE_SNAPSHOTS=1 moonx accounts:test-vrt
```

(The env var — rather than `-- --update-snapshots` — because moon `script` tasks
do not forward passthrough arguments.) **Review rule: a diff means LOOK at it.**
Open the actual/expected/diff attachments under
`/tmp/cynco-<project>-vrt-results*/`, decide whether the change is intended, and
only then update. Blind-updating baselines deletes the lane's entire value.

## Repo-invariant guards

Three root tasks turn architectural comments into CI failures (all wired as
`runInCI: 'always'` targets in `ci.yml`; unit tests for their pure logic live in
`scripts/*.test.ts` and run via `root:test`):

- **`root:assert-tiers`** (`scripts/assert-tiers.ts`): dependency edges between
  packages must point down the tier matrix (domain → surface/engine → fixtures).
- **`root:assert-wiring`** (`scripts/assert-wiring.ts`): every hand-maintained
  package list matches the workspace — dist-producing (`tsdown`-tagged) packages
  appear in root `moon.yml` `dependsOn`; `publishable`-tagged packages have
  `PUBLISH_CONFIGS` entries (and vice versa); every `@cynco/*` dependency of
  `apps/docs` is built by the deploy-docs workflow's "Build package
  dependencies" step; publishable packages carry
  `README.md`/`LICENSE.md`/`sideEffects`; inlined dependencies and
  `PRIVATE_PACKAGES` match the manifests. Motivated by two incidents where a new
  package skipped `dependsOn` and the docs-deploy build list.
- **`root:assert-lockstep`** (`scripts/assert-lockstep.ts`): the deliberately
  duplicated types/tables (the currency exponent table, `AmountFormat` and its
  presets, importers' copies of the entry shapes, and CSS px/ms values mirrored
  by JS constants) are compared as normalized source text against a central
  `MIRROR_REGISTRY` — the mechanical form of every "MUST mirror" comment,
  motivated by the partial currency-table copy that once mis-scaled currencies
  100×/10×. `packages/importers/test/lockstepParity.test.ts` remains alongside
  it: that suite also asserts runtime/compile-time facts (the exported table
  agrees with its own source; parser output is assignable to the reconciliation
  input shape) that only the package's own test context can check.

## CI

`.github/workflows/ci.yml` runs
`moon ci --include-relations :build demo:build docs:build :test :typecheck journals:test-e2e accounts:test-e2e root:lint root:lint-css`
after a format check. `moon ci` applies affected-filtering: bare `:test` binds
only to projects affected by the changed files (diffed against the merge base),
while the explicitly named targets pin the cross-project consumers. The
Playwright browser install is itself skipped when no e2e target is affected.
Locally, `moonx :test --affected` gives the same touched-projects-only test run.

## Policy

New features land with unit coverage, and — where the behavior is user-visible
in a real browser (scrolling, focus, pointer input, computed styles) — an e2e
fixture + spec alongside it. Suite sizes as of the last full runs (treat as a
floor — suites only grow):

| Project     | Unit tests | Files                          | E2e       | VRT shots |
| ----------- | ---------- | ------------------------------ | --------- | --------- |
| journals    | 280        | 30                             | 27 passed | 18        |
| accounts    | 230        | 24                             | 27 passed | 14        |
| ledger-core | 100        | 9                              | —         | —         |
| theme       | 219        | 4 (incl. contrast + CVD gates) | —         | —         |
| theming     | 31         | 4                              | —         | —         |
