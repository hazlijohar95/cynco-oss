---
name: publishing-and-release
description:
  Use when publishing an @cynco package, changing what a package inlines,
  editing scripts/publish.ts or a package's prepublish guard chain, or debugging
  a publish/assert-safe-publish failure.
---

# Publishing and Release

## The sanctioned path

Publish only through the shared pipeline, never a bare `pnpm publish`:

```bash
moonx theme:publish -- --dry-run
moonx accounts:publish -- --tag=beta
moonx journals:publish -- --tag=latest --promote-latest --tag-release
```

The pipeline lives in `scripts/publish.ts` and runs per package (moon sets the
package dir as cwd). It builds and runs guards, `pnpm pack`s the tarball,
rewrites the _unpacked_ manifest, verifies the payload, repacks, verifies the
final extracted tarball again, then publishes. The artifact that ships is the
artifact that was checked.

## Why bare `pnpm publish` is blocked

`@cynco/accounts` inlines `@cynco/ledger-store` and `@cynco/theme` into its dist
(tsdown `noExternal`), but its workspace manifest still declares them as
dependencies so local resolution works. Publishing that manifest verbatim would
break `pnpm add @cynco/accounts` — the engine is private and not on npm.
`packages/accounts/scripts/assert-safe-publish.ts` fails by design while those
inlined deps are still in the manifest; `scripts/publish.ts` is the one path
that rewrites the manifest before anything reaches the registry.

## The verification contract

`assertPublishPayload` in `scripts/publish.ts` fails a release if any of these
hold in the payload:

- A runtime dependency field names a private or inlined package (field-level
  match, so `@cynco/theme` is not confused with `@cynco/theming`).
- Any shipped text file contains a _quoted_ import specifier for a forbidden
  package (`.map` sourcemaps are exempt — they embed pre-bundling source that
  resolves nothing at runtime).
- A `.tsbuildinfo` file leaked into the payload.
- An `exports` entry points at a dist file that does not exist.
- `README.md` or `LICENSE.md` is missing.

`PRIVATE_PACKAGES` (`@cynco/ledger-store`, `@cynco/ledger-test-data`) may never
appear in any published payload or manifest, in any package.

## When a guard fires

- `assert-no-ledger-store` (runs on every `accounts:build`): a runtime or type
  import of the private engine survived bundling. Fix the import or the tsdown
  `noExternal` config — do not re-add the engine as a dependency.
- `assert-safe-publish`: you ran a raw publish path. Use
  `moonx <project>:publish` instead.
- Payload verification: read the offender list — it names the exact file and
  reason. A missing `exports` target usually means a stale `exports` entry after
  a build output changed.

## Adding a publishable package

Add it to `PUBLISH_CONFIGS` in `scripts/publish.ts` with its `project` name and
`inlinedDependencies`, give the package `tags: ['publishable']`, and add
`"prepublishOnly": "moon run <name>:prepublish"` to its `package.json`. The
publish unit tests (`scripts/publish.test.ts`, run by `moon run root:test`)
cover the inlining contract.
