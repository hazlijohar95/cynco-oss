---
name: publishing-and-release
description:
  Use when publishing an @cynco package, editing scripts/publish.ts or a
  package's prepublish guard chain, or debugging a publish/payload verification
  failure.
---

# Publishing and Release

## The sanctioned path

Publish only through the shared pipeline, never a bare `pnpm publish`:

```bash
moonx theme:publish -- --dry-run
moonx ledger-core:publish -- --tag=beta
moonx journals:publish -- --tag=latest --promote-latest --tag-release
```

The pipeline lives in `scripts/publish.ts` and runs per package (moon sets the
package dir as cwd). It builds and runs guards, `pnpm pack`s the tarball,
rewrites the _unpacked_ manifest (dropping release-only fields: `scripts` and
`devDependencies`), verifies the payload, repacks, verifies the final extracted
tarball again, then publishes. The artifact that ships is the artifact that was
checked.

Every workspace dependency between published packages is a real npm dependency —
nothing is inlined or stripped. Publish foundations first (`@cynco/ledger-core`,
`@cynco/theme`) so the exact versions `pnpm pack` pins into dependents already
exist on the registry.

## The verification contract

`assertPublishPayload` in `scripts/publish.ts` fails a release if any of these
hold in the payload:

- A runtime dependency field names a private package (field-level match, so
  `@cynco/theme` is not confused with `@cynco/theming`).
- Any shipped text file contains a _quoted_ import specifier for a private
  package (`.map` sourcemaps are exempt — they embed pre-bundling source that
  resolves nothing at runtime).
- A `.tsbuildinfo` file leaked into the payload.
- An `exports` entry points at a dist file that does not exist.
- `README.md` or `LICENSE.md` is missing.

`PRIVATE_PACKAGES` (`@cynco/ledger-test-data`) may never appear in any published
payload or manifest, in any package.

## When a guard fires

- Payload verification: read the offender list — it names the exact file and
  reason. A missing `exports` target usually means a stale `exports` entry after
  a build output changed.
- publint / arethetypeswrong failures: the final artifact is broken for some
  real consumer resolution mode; fix the exports map or the build output, not
  the checker.

## Adding a publishable package

Add it to `PUBLISH_CONFIGS` in `scripts/publish.ts` with its `project` name,
give the package `tags: ['publishable']`, and add
`"prepublishOnly": "moon run <name>:prepublish"` plus
`"publishConfig": { "access": "public" }` to its `package.json`. It also needs
`README.md`, `LICENSE.md`, an explicit `sideEffects` field, and a docs page
wired into `apps/docs/lib/site.ts` — `root:assert-wiring` and `root:assert-docs`
fail with the exact missing piece otherwise. The publish unit tests
(`scripts/publish.test.ts`, run by `moon run root:test`) cover the release
table.
