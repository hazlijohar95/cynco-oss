---
name: tooling-and-dependencies
description:
  Use when running repo scripts, adding or changing dependencies, editing
  package.json files, installing packages, publishing packages, running moon
  tasks, or working with worktrees and dev-server ports.
---

# Tooling and Dependencies

## Toolchain (proto)

- Tool versions (bun, node, pnpm, moon) are pinned in `.prototools` and managed
  by [proto](https://moonrepo.dev/docs/proto); its shims put the pinned versions
  on PATH inside the repo. `proto use` installs everything after a pin changes.
- Bump a tool by editing `.prototools` only — never install tools globally or
  pin versions elsewhere. moon's version is additionally enforced by
  `versionConstraint` in `.moon/workspace.yml` and mirrored as the
  `@moonrepo/cli` catalog entry (for Vercel builders without proto); keep all
  three in sync.
- CI installs the same toolchain via `moonrepo/setup-toolchain`, which runs
  `proto install` against the same `.prototools`. Local and CI resolve
  identically.

## Package Manager and Runtime

- Use `pnpm` for package operations: install, add, remove, dedupe, lockfile, and
  publish work. Do not use `bun`, `npm`, `yarn`, or `npx` for package operations
  unless there is a specific documented reason.
- Bun is the direct TypeScript runtime and test runner where moon tasks use it
  (`bun test`, `bun scripts/*.ts`). Local scripts stay `.ts` with no separate
  compile step.

## Dependency Catalog

External dependency versions live in the `catalog` in `pnpm-workspace.yaml`.

- Never add a version directly to an individual package's `package.json`.
- To add a dependency: add the exact version under `catalog:` in
  `pnpm-workspace.yaml`, then reference it from the package as
  `"the-package": "catalog:"`.
- Do not run `pnpm add <package>` inside a package directory; it writes a direct
  version and breaks the catalog pattern.
- Internal packages use `"@cynco/...": "workspace:*"`.

### Supply-chain policy — do not bypass

`pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days): a dependency
version must be at least a week old before it can be installed, which defeats
fresh-compromise npm attacks. A handful of first-party and platform-binary
packages are in `minimumReleaseAgeExclude`. Do not add an exclusion or lower the
age to pull in a day-zero release without a deliberate reason.

Dependabot is configured for GitHub Actions only (it keeps the SHA-pinned
actions and their `# vX.Y.Z` comments fresh). npm is intentionally excluded so
Dependabot cannot bypass the release-age policy. Every external GitHub Action
must be pinned to a full 40-character commit SHA — the `actions-pinned` CI job
fails the build otherwise.

## Tasks

- All build/dev/test/lint entrypoints are moon tasks; `package.json` scripts
  exist only for npm lifecycle hooks (`prepublishOnly`). Never add task scripts
  back to a package.json.
- Tasks are defined in `.moon/tasks/*.yml` (inherited by language or tag) and
  each project's `moon.yml`. Repo-wide tooling (format, lint, clean, wt) lives
  on the `root` project.

```bash
moon run <project>:<task>
moonx <project>:<task>             # same engine; shorthand for moon exec
moonx <project>:<task> -- --flags  # forward arguments after --
moon run :test                     # a task across every project that has it
moon tasks <project>               # discover a project's tasks
moon project <project>             # inspect config and dependencies
```

moon builds dependency projects first (`deps: ['^:build']`), caches outputs, and
skips tasks whose inputs have not changed. `moonx`/`moon exec` exposes CI
overrides (`--ignore-ci-checks`) that `moon run` lacks. `moon ci` is the
affected-aware orchestrator used only by `.github/workflows/ci.yml`; do not
reach for it locally.

Local-only tasks set options explicitly rather than using moon presets (presets
force `runInCI: skip`, which moon refuses to run in CI-detected shells; agent
harnesses export `CI=1`):

- No graph edges (formatters, benchmarks, wt): `runInCI: 'always'` — runnable
  everywhere, never affected through the graph so never pulled into CI.
- Connected to the build graph (dev servers, publish guards): keep
  `runInCI: 'skip'` and run in CI-marked shells with
  `moonx <target> --ignore-ci-checks`. For non-moon commands that CI-gate
  themselves: `CI= pnpm publish --dry-run`.

## Worktrees and Dev-Server Ports

`scripts/wt.ts` (also `moonx root:wt -- <subcommand>`) manages sibling git
worktrees at `<primary>-worktrees/<name>/` so multiple checkouts run dev servers
and e2e suites without port collisions.

```bash
bun scripts/wt.ts create <branch>   # add worktree, claim ports, pnpm install
bun scripts/wt.ts list              # name, offset, branch, path
bun scripts/wt.ts sync              # (re)write .env.worktree files
bun scripts/wt.ts remove <name>     # kill servers, remove worktree + merged branch
```

Each worktree owns a gitignored `.env.worktree` with `CYNCO_PORT_OFFSET` (slot
index × 1000; primary is slot 0 with historical ports). Port-binding tasks load
it via `envFile: '/.env.worktree'` and bind `base + offset`: demo 4600, docs
4700, journals e2e 4283, accounts e2e 4383. If you start dev servers or e2e
fixtures in a worktree, clean them up before completing your turn.
