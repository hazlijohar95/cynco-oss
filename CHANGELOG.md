# Changelog

All notable changes to the published `@cynco/*` packages are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages adhere to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with a manual,
human-driven bump policy (see `PUBLISHING.md` — no changesets, by design).

The private fixtures package (`@cynco/ledger-test-data`) is not tracked here: it
never reaches npm.

## [Unreleased]

### @cynco/ledger-core — 0.1.0-beta.1 (new package)

#### Added

- The engine is now a published package — previously private and inlined into
  `@cynco/accounts` and `@cynco/statements` at build time, it is the suite's
  foundation and ships on npm like everything else: the double-entry data model
  (`LedgerEntry`, `Posting`, `BankStatementLine`), the integer minor-unit money
  kernel, `EntryStore` / `AccountStore`, the statement derivations, the account
  taxonomy, the canonical ISO 4217 exponent table, and the shared `AmountFormat`
  presets.
- `BankStatementLine`: the bank-statement reconciliation input shape moved into
  the engine as the canonical definition; `@cynco/journals` and
  `@cynco/importers` re-export it as `StatementLine`, unchanged.
- `AmountFormat` and the five `AMOUNT_FORMAT_*` presets moved into the engine
  from `@cynco/journals`; every rendering package re-exports the same objects.
- Consequence across the suite: the lockstep-duplicated types and tables (entry
  shapes, currency exponent table, amount-format presets) are deleted — every
  package imports the one canonical definition from the engine, so the drift
  class that once mis-scaled zero- and three-decimal currencies 100×/10× can no
  longer exist. `@cynco/journals`, `@cynco/accounts`, `@cynco/statements`, and
  `@cynco/importers` now declare `@cynco/ledger-core` as a regular npm
  dependency; published manifests are no longer rewritten to strip inlined
  dependencies.

### @cynco/importers — 0.1.0-beta.1 (new package)

#### Added

- New package: bank statement parsers producing reconciliation-ready statement
  lines and balanced draft ledger entries. Pure data, no DOM, no third-party
  runtime dependencies (the shared shapes come from `@cynco/ledger-core`).
- `parseCsvStatement` — explicit column mapping (indices or header names, no
  sniffing), RFC 4180 tokenizer (quoted fields, escaped quotes, embedded
  delimiters/newlines, CRLF), single-amount or debit/credit split columns, four
  explicit date formats, decimal-comma amount support, malformed rows skipped
  with a per-line reason — never silently dropped.
- `parseOfx` — OFX 1.x (SGML) and 2.x (XML) via one tolerant tag scanner,
  `STMTTRN` extraction (FITID ids, signed amounts, date-prefix parsing),
  multi-statement grouping, `CURDEF` with explicit fallback.
- `proveRunningBalance` — verifies opening + Σ amounts equals every provided
  running balance to the minor unit; breaks report exact locations. Importers
  never invent or repair data.
- `toDraftEntries` — single-sided statement lines become balanced `pending`
  entries against a caller-named suspense account with deterministic ids.
- Amounts parse from digit strings against the ISO 4217 exponent table — no
  floats anywhere; over-precise amounts are rejected, not rounded.
- Statement-line and ledger types are imported from `@cynco/ledger-core` — the
  same definitions the reconciliation UI consumes, so parser output feeds it
  unadapted.

### @cynco/statements — 0.1.0-beta.1 (new package)

#### Added

- New package: financial statement derivations and renderers, built on the
  published `@cynco/ledger-core` engine (re-exported, so consumers install one
  package).
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

### Engine (surfaces through `@cynco/accounts` and `@cynco/statements`)

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
