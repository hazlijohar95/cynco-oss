# Changelog

All notable changes to the published `@cynco/*` packages are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages adhere to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with a manual,
human-driven bump policy (see `PUBLISHING.md` — no changesets, by design).

Private workspace packages (`@cynco/ledger-core`, `@cynco/ledger-test-data`) are
not tracked here: they never reach npm. The ledger-core engine ships inlined
inside `@cynco/accounts`.

## [Unreleased]

Nothing yet.

## 2026-07-21 — first release

The first versions published to npm: `@cynco/theme@0.1.0` (dist-tag `latest`)
and `@cynco/theming@0.1.0-beta.1`, `@cynco/journals@0.1.0-beta.1`,
`@cynco/accounts@0.1.0-beta.1` (dist-tags `beta` and `latest`, so bare installs
resolve).

### @cynco/theme — 0.1.0

#### Added

- Light/dark palettes and semantic role sets for ledger UIs, including soft
  variants and CVD-safe (deuteranopia/protanopia and tritanopia) role sets.
- Color science module (sRGB conversions, contrast, delta-E, CVD simulation)
  backing measured accessibility gates that run as tests.
- `themeToCSSVariables` for emitting `--*-theme-*` custom-property chains.

### @cynco/theming — 0.1.0-beta.1

#### Added

- Runtime theme controller: light/dark/system mode resolution, theme catalogs
  (`createThemeCatalog`, a default catalog), and persistence.
- `applyThemeToElement` applying role variables for both `--journals-*` and
  `--accounts-*` prefixes plus a `color-scheme` pin.
- React bindings for connecting the controller to component trees.

### @cynco/journals — 0.1.0-beta.1

#### Added

- Framework-agnostic journal entry and account register rendering (`LedgerView`
  v2) with period grouping, range selection, `EntryDiff`, ARIA grid semantics,
  keyboard navigation, and a custom scroll engine.
- Register filter with match highlighting and live-region announcements.
- Reconciliation component with a sum-matching engine.
- Worker support: worker pool, entry streaming, plus `./worker/worker.js` and a
  fully-bundled `./worker/worker-portable.js` entry for bundlers that cannot
  follow package imports inside workers.
- React and SSR subpath exports (`./react`, `./ssr`).

### @cynco/accounts — 0.1.0-beta.1

#### Added

- Path-first chart-of-accounts tree with per-account balances, rename,
  drag-and-drop with drop-collision strategies, and subtree flattening.
- Context menus, IME-safe editing guards, search modes with middle truncation,
  and a sticky ancestor stack.
- Account icons, row decorations, and lazy child loading backed by the engine's
  child-load state machine.
- React and SSR subpath exports (`./react`, `./ssr`).
- The private `@cynco/ledger-core` engine is inlined into `dist/` at build time;
  a post-build gate asserts it never leaks as a runtime import.
