# CyncoJS Monorepo

## Agent Environment

Set `AGENT=1` at the start of every terminal session so Bun's test runner emits
AI-friendly output:

```bash
export AGENT=1
```

Most local moon tasks (formatters, benchmarks) are configured with
`runInCI: 'always'` so they keep working in CI-marked shells like agent
harnesses. Tasks connected to the build graph (dev servers, publish guards) stay
CI-skipped — run those with `moonx <target> --ignore-ci-checks`, e.g.
`moonx docs:dev --ignore-ci-checks`. For non-moon commands that CI-gate
themselves, unset the var: `CI= pnpm publish --dry-run`.

## Toolchain

- Tool versions (bun, pnpm, node, moon) are pinned in `.prototools` and managed
  by [proto](https://moonrepo.dev/docs/proto); run `proto use` if a tool is
  missing or a pin changed. Never install toolchain versions globally; bump pins
  only in `.prototools`.
- [moon](https://moonrepo.dev/docs) is the task runner; `package.json` scripts
  are npm lifecycle hooks only.

## Core Rules

- Use `pnpm` for install/add/remove/dedupe/package-manager and publishing work.
  Do not use `bun`, `npm`, `yarn`, `npx`, or similar tools for package
  operations unless there is a specific reason.
- Dependencies use the `catalog` in `pnpm-workspace.yaml`. Never add dependency
  versions directly to package-level `package.json` files unless a published
  package intentionally needs its own range.
- Run tasks through moon: `moon run <project>:<task>` (or the `moonx` shorthand)
  works from anywhere in the repo. `moonx <project>:<task> -- args` forwards
  arguments. Discover tasks with `moon tasks <project>`.
- Preserve trailing newlines at the end of files.

## Skills

Domain-specific context and conventions live in `.agents/skills/`. Before
starting any task:

1. List `.agents/skills/*/SKILL.md`
2. Read only each skill's frontmatter description to identify relevant skills
3. Read only the full `SKILL.md` files relevant to your task

Do not load skills that are not relevant to the task. The Money Invariants below
are the load-bearing summary; `ledger-invariants` holds the full detail.

## Agent Artifacts

Write agent-only planning and scratch artifacts under `.agents/ignore/` by
default:

- Plans: `.agents/ignore/plans/YYYY-MM-DD-<topic>.md`
- Specs: `.agents/ignore/specs/YYYY-MM-DD-<topic>.md`

`.agents/ignore/` is gitignored. Do not put source files, tests, or committed
documentation there.

## Money Invariants

- Amounts are integer minor units (sen, cents) end to end. No floats touch
  monetary values anywhere in the codebase — parsing, arithmetic, rendering.
- Every journal entry must balance: the sum of posting amounts per currency is
  exactly zero. Renderers may display unbalanced input (flagged), but the data
  layer never silently repairs it.
- Account paths are canonical colon-delimited strings
  (`Assets:Current:Cash-Maybank`) at every public API boundary. Numeric node IDs
  never leak out of the store.

## Verification Baseline

After code changes, verification is not complete until you have run these from
anywhere in the repo:

```bash
moon run root:format root:lint
```

Also run the affected typecheck and focused tests for the changed area, e.g.
`moonx <project>:typecheck` and `moonx <project>:test` (or
`moonx :typecheck --affected`). For docs-only changes, formatting and linting
are sufficient unless the edit touches executable code or package config.

## Code Readability

- Function-level comments over inline; explain why the helper exists for readers
  new to the codepath.
- One function/concern per file where practical; filename matches the exported
  symbol.
- Parsers degrade gracefully instead of throwing; `null` for absent values.
- No accidental O(n²): precompute boundaries before loops, prefer maps/sets, use
  typed arrays for hot per-row data.
