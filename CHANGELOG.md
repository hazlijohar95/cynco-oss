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

### @cynco/statements — 0.1.0-beta.1 (new package)

#### Added

- New package: financial statement derivations and renderers, with the
  ledger-core engine inlined like `@cynco/accounts`.
- Statement derivations (report-time, one linear pass, per-currency sections —
  cross-currency totals are refused, never silently converted):
  - `deriveTrialBalance` — debit/credit columns from signed balances, abnormal
    balance flags, working-trial-balance mode (unadjusted / adjustments /
    adjusted via an `EntryFilter`), zero-activity chart accounts, computed
    (never asserted) balance proof.
  - `deriveIncomeStatement` — period-activity P&L with comparative period
    columns, section-based presentation sign flip (revenue positive, contra
    income negative), per-period totals and net income.
  - `deriveBalanceSheet` — position statement with virtual closing: retained and
    current-year earnings are computed per column (optional fiscal-year split),
    never booked; the accounting equation is checked per date and reported
    honestly.
- Account taxonomy: `createAccountTaxonomy` classifies canonical paths into the
  five account types with derived normal balance and statement role; opinionated
  defaults (`Assets`…`Expenses`, `Revenue` synonym) with full override escape
  hatches (custom roots, per-subtree type/contra overrides). Unclassifiable
  accounts surface as `null` / `unclassified` — flagged, never guessed into a
  section.
- Balance assertions: `checkBalanceAssertions` — declarative "account held
  exactly X on date D" checks reporting actual/difference/ok; flag, never
  repair.
- Opening balances: `createOpeningBalanceEntry` builds the day-one entry
  balanced by construction against `Equity:Opening-Balances` (one offset per
  currency).
- Currency registry: `getCurrencyExponent` with the full ISO 4217 minor-unit
  exception table (0/3/4-decimal currencies), caller overrides, graceful
  2-decimal fallback.
- `TrialBalance` renderer (vanilla + React): semantic per-currency tables,
  data-attribute contract, digit-string amount formatting, abnormal and
  unclassified row flags, visible out-of-balance row when the columns do not
  tie.
- `IncomeStatement` renderer (vanilla + React): income/expense groups with
  per-period comparative columns, group totals under a single rule, net income
  under the double rule, flagged unclassified group.
- `BalanceSheet` renderer (vanilla + React): asset/liability/equity groups per
  reporting date, computed retained/current-year earnings rows
  (`data-computed`), Total Liabilities & Equity proof line, per-column
  out-of-balance flags when the equation breaks.
- Demo: a Financial statements section deriving all three statements live from
  the workload entries, with the tie and equation proofs narrated in the
  readout.

### Engine (inlined; surfaces through `@cynco/accounts` and `@cynco/statements`)

#### Added

- `EntryStore.getBalancesAsOf` / `getBalanceChanges`: point-in-time and
  period-movement balance queries answered by binary search over the cached
  register prefix sums — warm reads never re-scan the entry list.
- `matchesEntryFilter`: pure `EntryFilter` matcher shared by report derivations,
  behavior-identical to the store's cached matcher.
- `negateMinorUnits`: sign flip that can never produce IEEE `-0`.

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
