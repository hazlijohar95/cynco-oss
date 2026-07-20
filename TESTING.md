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
- **Benchmarks** (`moonx <project>:benchmark`): never in CI; see
  `PERFORMANCE.md`.

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

| Project     | Unit tests | Files                          | E2e       |
| ----------- | ---------- | ------------------------------ | --------- |
| journals    | 280        | 30                             | 27 passed |
| accounts    | 230        | 24                             | 27 passed |
| ledger-core | 100        | 9                              | —         |
| theme       | 219        | 4 (incl. contrast + CVD gates) | —         |
| theming     | 31         | 4                              | —         |
