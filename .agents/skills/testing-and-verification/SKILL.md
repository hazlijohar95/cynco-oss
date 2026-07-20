---
name: testing-and-verification
description:
  Use when adding or running tests, checking snapshots, choosing between Bun
  tests and Playwright, running lint/format/typecheck, understanding the
  money/CVD/contrast gates, or deciding the verification scope for a change.
---

# Testing and Verification

## Baseline Commands

After code changes, run the required baseline (moon tasks run from anywhere in
the repo, including CI-marked agent shells):

```bash
moon run root:format root:lint
```

Useful check/fix pairs on the root project:

```bash
moon run root:format-check
moon run root:format
moon run root:lint
moon run root:lint-fix        # mutates code; CI-skip, run as `CI= moon run root:lint-fix`
moon run root:lint-css
moon run root:lint-css-fix
```

For code changes, also run the relevant typecheck (moon builds workspace
dependencies first, since cross-package types resolve through each dependency's
built dist):

```bash
moonx <project>:typecheck
# or, scoped to what actually changed:
moonx :typecheck --affected
```

## Unit and Integration Tests

Use Bun's built-in test runner. Tests live in a `test/` folder inside each
package and use `describe`, `test`, and `expect` from `bun:test`.

```bash
moonx accounts:test
moonx journals:test
moonx ledger-store:test
moon run :test               # every project's suite
```

Tests import workspace dependencies through their built dist (same resolution as
typecheck), so moon builds those first. Running `bun test` directly inside a
package also works when its dist is fresh.

## The Objective Gates

Some correctness concerns are enforced as tests that fail the build, not as
review checklist items. Treat these as invariants, not suggestions:

- **Money / balancing** — `packages/accounts` and `packages/journals` suites
  assert integer-minor-unit arithmetic and per-currency zero-sum balancing. See
  the `ledger-invariants` skill.
- **CVD gate** — `packages/theme/test/cvd.gate.test.ts` simulates every
  color-vision deficiency (Machado 2009, severity 1.0) and fails if the
  debit/credit or success/danger pairs stop being distinguishable (ΔE₀₀ ≥ 20) or
  legible on the editor background (WCAG ≥ 3:1).
- **Contrast gate** — `packages/theme/test/contrast.gate.test.ts` holds theme
  roles to their WCAG bar.

When you change palettes, roles, or any money path, run the relevant gate before
calling the work done. Do not weaken a gate threshold to make a change pass
without an explicit, reasoned decision.

## Snapshots

Bun supports `toMatchSnapshot()`. Avoid new snapshot coverage unless it is
shallow and narrowly scoped to the exact behavior under test. Update snapshots
from the package directory:

```bash
bun test -u
```

## Browser and E2E Tests

Add Playwright E2E tests only when behavior cannot be validated without a real
browser engine (computed styles, shadow DOM boundaries, browser-only render
behavior). Keep E2E coverage small and high-value.

```bash
moonx accounts:test-e2e
moonx journals:test-e2e
```

The e2e tasks run against the BUILT dist served by a harness Vite server and
self-heal a missing Chromium binary. In a worktree, port offsets come from
`/.env.worktree` (see the `tooling-and-dependencies` worktree notes).
