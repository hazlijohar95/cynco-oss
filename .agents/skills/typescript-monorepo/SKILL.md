---
name: typescript-monorepo
description:
  Use when adding or changing packages/apps, TypeScript configs, workspace
  dependencies, package exports, tsdown build config, or the moon project graph.
---

# TypeScript Monorepo

## TypeScript

Use TypeScript everywhere practical. Compiler settings are intentionally strict.

- Shared compiler options live in `tsconfig.options.json`; every package
  tsconfig extends it.
- Typechecking uses `tsgo` (TypeScript native preview) and runs through moon:
  `moonx <project>:typecheck`.

## Cross-package resolution

Unlike a project-references setup, Cynco packages resolve each other through
each dependency's **built dist**, not through TS project references. That is why
`test` and `typecheck` both declare `deps: ['^:build']` — moon builds the
workspace dependencies first. If types look stale, the dependency's dist is
stale; rebuild it.

## Adding a package or app

- Add it under `packages/*` or `apps/*` (the globs in `.moon/workspace.yml` and
  `pnpm-workspace.yaml` pick it up automatically).
- Give it a `moon.yml` with `language`, `layer`, and `tags`. Shared tasks come
  from `.moon/tasks/*.yml` via those tags:
  - `tags: ['tsdown']` — inherits the tsdown `build`/`dev` tasks.
  - `tags: ['publishable']` — inherits the `assert-pnpm-version`, `prepublish`,
    and `publish` guard chain.
- Follow an existing package's tsconfig shape.
- If it is a cross-project consumer whose build must run in CI when a dependency
  changes (like `apps/docs` when a package changes), add it by name to the
  explicit target list in `.github/workflows/ci.yml` — bare `:task` shapes only
  bind to projects affected by changed _files_.

## Workspace Dependencies

- External packages: use the `catalog:` reference (see
  `tooling-and-dependencies`).
- Internal packages: `"@cynco/<name>": "workspace:*"`.

## Build config (tsdown)

- Packages bundled with tsdown carry `tags: ['tsdown']`; overrides
  (`merge: 'replace'`) live in the project's `moon.yml`.
- If a task ever bundles another package's source (journals' portable worker
  bundles everything, for example), list that source in the task `inputs` so
  cache invalidation is honest.

## Published packages

Before changing a published package's public entrypoints or dependency ranges,
review its `exports`, `files`, peer dependencies, and its `prepublish` task
chain. The publish pipeline verifies that every `exports` entry is backed by a
real dist file and that no private package leaks — see the
`publishing-and-release` skill.
