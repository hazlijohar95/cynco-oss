# Publishing @cynco packages

Releases are driven by `scripts/publish.ts`, invoked per package through the
`publish` moon task that every `publishable`-tagged project inherits:

```bash
moonx theme:publish -- --dry-run
moonx accounts:publish -- --tag=beta
moonx journals:publish -- --tag=latest --promote-latest --tag-release
```

The script builds the package, packs a source tarball, rewrites the packed
package metadata, repacks a final tarball, verifies that tarball, and uploads it
to npm. The tarball rehearsed with `--dry-run` is byte-for-byte the tarball that
gets published.

## What is published (and what is not)

| Package              | npm | Notes                                               |
| -------------------- | --- | --------------------------------------------------- |
| `@cynco/ledger-core` | yes | The engine. No workspace dependencies.              |
| `@cynco/theme`       | yes | No workspace dependencies.                          |
| `@cynco/theming`     | yes | Depends on `@cynco/theme`.                          |
| `@cynco/journals`    | yes | Depends on `@cynco/ledger-core` and `@cynco/theme`. |
| `@cynco/accounts`    | yes | Depends on `@cynco/ledger-core` and `@cynco/theme`. |
| `@cynco/statements`  | yes | Depends on `@cynco/ledger-core` and `@cynco/theme`. |
| `@cynco/importers`   | yes | Depends on `@cynco/ledger-core`.                    |

`@cynco/ledger-test-data` is **never** published: it is deterministic test
fixtures, and no published payload may reference it (the payload verification
scans for it). Every other workspace dependency is a real npm dependency —
nothing is inlined or stripped.

**Publish order matters for a coordinated release**: `@cynco/ledger-core` and
`@cynco/theme` first, then everything that depends on them. `pnpm pack` rewrites
`workspace:*` ranges to the exact resolved version, so a consumer of
`@cynco/journals@X` needs the pinned `@cynco/ledger-core` and `@cynco/theme`
versions to already exist on the registry.

## Version bump policy

Versions are bumped **manually** — no changesets, no semantic-release. This is
deliberate: the repo publishes a small, tightly-coupled set of packages on a
`0.1.0-beta.<n>` track, and a human deciding "this is a release" is the whole
process. Automation would add release-PR machinery without removing any of the
actual work (writing the changelog entry honestly).

To cut a release:

1. Create a release branch.
2. Bump `version` in each `packages/<pkg>/package.json` being released. Bump
   `<n>` in `0.1.0-beta.<n>` for beta iterations; graduate to `0.1.0` only with
   a deliberate decision to leave beta.
3. Add a dated entry to `CHANGELOG.md` (Keep a Changelog format, per-package
   subsections).
4. `pnpm install` to refresh `pnpm-lock.yaml`, commit, open a PR, merge.
   Releases are cut from merged commits on the main branch.

## The guard chain

Every published package's `prepublishOnly` points at
`moon run <project>:prepublish` (pnpm-version pin check + build), so even a
direct `pnpm publish` builds and checks first. The sanctioned path is still
`moonx <project>:publish`, which adds full payload verification.

The publish script:

1. Refuses to run on a dirty working tree (override with `--dirty`).
2. Checks the pnpm version pin and runs `moon run <project>:build`.
3. `pnpm pack` into a tempdir (this rewrites `workspace:*` to resolved versions)
   and untars the payload.
4. Rewrites the packed `package.json`: drops `scripts` (the only entry is the
   repo-only prepublishOnly hook) and `devDependencies` (npm ignores it, but it
   names private workspace packages).
5. Verifies the payload: no private package appears in any runtime dependency
   field or as a quoted import specifier in any shipped file (sourcemaps
   excluded — they embed pre-bundling source text that nothing resolves), no
   `*.tsbuildinfo` leaked, every `exports` entry points at a file that exists,
   README.md and LICENSE.md are present.
6. Repacks the rewritten payload into the final tarball and verifies the
   extracted final tarball again — the artifact that ships is the artifact that
   was checked.
7. Verifies consumer correctness of that same final artifact (also during
   `--dry-run` — these are verification, not upload):
   - **publint** (node API) lints the extracted final payload for
     manifest/payload mismatches: broken exports condition order, missing or
     wrongly-formatted entry files, invalid exports values. `error`-severity
     messages fail the release; `warning`s are printed but do not block;
     `suggestion`s are filtered out entirely.
   - **arethetypeswrong** (`@arethetypeswrong/core`, `checkPackage` on the final
     tarball bytes) resolves every entrypoint the way real TypeScript consumers
     do (`node10`, `node16-cjs`, `node16-esm`, `bundler`). Any problem fails the
     release — a d.ts referencing a private package surfaces here as an internal
     resolution error — except two explicitly allowlisted consequences of
     shipping ESM-only (`"type": "module"`) packages: `CJSResolvesToESM` in
     `node16-cjs` mode (by design; Node ≥ 20.19 supports `require(esm)`) and
     `NoResolution` in `node10` mode (node10 resolution could never load ESM at
     runtime anyway). Allowlisted hits are printed with their justification;
     packages that are not ESM-only get zero exemptions. The same checks are
     runnable by hand via the `attw` and `publint` CLIs (both are root
     devDependencies).
8. Publishes the final tarball (or stops after step 7 with `--dry-run`).

The pure pieces of this pipeline (flag parsing, manifest rewriting, specifier
scanning, OTP redaction, publint message partitioning, the attw allowlist
verdict) are unit-tested in `scripts/publish.test.ts`, run by
`moon run root:test`.

## OTP / 2FA behavior

moon captures task stdio, so pnpm cannot prompt for a one-time password through
the normal channel. The script attaches the upload and dist-tag steps directly
to `/dev/tty`, so run publishes from a real terminal and answer the prompt when
npm asks (this also supports web-based 2FA).

Alternatively pass a freshly generated classic OTP explicitly:

```bash
moonx accounts:publish -- --tag=beta --otp=123456
```

The script forwards the OTP to `pnpm publish` and `pnpm dist-tag add`, and
redacts the value from every command line it logs.

## Flags

| Flag                            | Effect                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| `--dry-run`                     | Everything except upload; prints manifest diff + tarball listing. |
| `--tag=<dist-tag>`              | npm dist-tag (default `beta`).                                    |
| `--otp=<code>` / `--otp <code>` | Forward a classic OTP; redacted from logs.                        |
| `--promote-latest`              | `pnpm dist-tag add <pkg>@<version> latest` after publish.         |
| `--tag-release`                 | Create and push a git tag `<pkg>@<version>`.                      |
| `--release-branch=<b>`          | Fail unless HEAD is on branch `<b>`.                              |
| `--dirty`                       | Skip the clean-worktree check (know why before using).            |

Agent/CI-marked shells: the publish task is `runInCI: 'skip'`, so prefix with
`CI=` if your shell exports CI, e.g. `CI= moonx theme:publish -- --dry-run`.

## Rehearse, publish, promote

```bash
# 1. Rehearse (offline-safe; no npm auth needed)
moonx theme:publish -- --dry-run

# 2. Confirm auth (must have publish access to the @cynco scope)
pnpm whoami

# 3. Publish to beta, foundations first
moonx ledger-core:publish -- --tag=beta
moonx theme:publish -- --tag=beta
moonx theming:publish -- --tag=beta
moonx journals:publish -- --tag=beta
moonx accounts:publish -- --tag=beta
moonx statements:publish -- --tag=beta
moonx importers:publish -- --tag=beta

# 4. Verify on npm
pnpm view @cynco/accounts@<version> version
pnpm view @cynco/accounts dist-tags --json

# 5. Smoke test, then promote
moonx accounts:publish -- --tag=latest --promote-latest --tag-release
```

### Consumer smoke tests

Create a fresh consumer app **outside** the monorepo so workspace resolution
cannot mask packaging bugs — either against the beta publish or by installing
the final tarball path printed by `--dry-run`. Check at minimum:

- `ls node_modules/@cynco` shows only published packages (no
  `ledger-test-data`).
- Typecheck and production-build the consumer.
- Exercise each subpath export (e.g. `@cynco/journals`, `/react`, `/ssr`,
  `/worker`; `@cynco/accounts`, `/react`, `/ssr`).
- For journals/accounts, render against React 18.3.1 and React 19.

Note pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml` applies to consumers
inside this workspace; fresh external consumers install immediately.

## Recovering from a failed publish

Publish is atomic per tarball — the script either uploads the final artifact or
it doesn't. If `pnpm publish` fails inside the script, nothing was uploaded:
fix, commit, re-run.

If a publish succeeded but smoke tests fail afterwards, **do not
`pnpm unpublish`**. Bump to the next `0.1.0-beta.<n+1>`, publish again, and
leave the broken version stranded with its bad dist-tag.

## Release checklist

- [ ] release branch cut, `version` bumped in each released package
- [ ] `CHANGELOG.md` entry added (dated, per-package subsections)
- [ ] `pnpm install` run, lockfile committed, release PR merged
- [ ] `pnpm whoami` confirms publish access to `@cynco`
- [ ] `moonx <pkg>:publish -- --dry-run` reviewed for each package
      (`scripts`/`devDependencies` gone everywhere)
- [ ] published to `beta` in dependency order (`ledger-core` and `theme` first)
- [ ] consumer smoke tests passed (no private packages in `node_modules`)
- [ ] `--promote-latest` run per package after smoke verification
- [ ] git tags pushed (`--tag-release` or manual `<pkg>@<version>` tags)
