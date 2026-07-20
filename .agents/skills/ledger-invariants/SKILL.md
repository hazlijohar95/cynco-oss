---
name: ledger-invariants
description:
  Use when touching monetary amounts, journal entries, postings, balancing,
  account paths, or anything that reads from or writes to the ledger-core
  engine. These invariants are correctness-critical: violating them silently
  corrupts financial data.
---

# Ledger Invariants

These are the rules that keep Cynco's accounting data correct. They are not
style preferences — a violation is a data-integrity bug.

## Money is integer minor units

- Amounts are integer minor units (sen, cents) end to end: parsing, arithmetic,
  storage, and rendering. No `number` float ever holds a monetary value, and no
  monetary path uses `/`, `*`, or `parseFloat` on a display string.
- Convert at the edges only. A source document string like `"1,234.56"` is
  parsed straight to the integer `123456`; it is never turned into `1234.56`
  first.
- When a currency's minor-unit scale matters (0-decimal, 3-decimal), carry the
  scale alongside the integer — never assume 2.

## Every entry balances

- A journal entry is valid only when, for each currency, the sum of its posting
  amounts is exactly `0`. Debits and credits are two signs of the same integer
  field, not two separate fields.
- The data layer never silently repairs an unbalanced entry. Balancing is
  asserted, not coerced.
- Renderers may display unbalanced input, but must flag it as unbalanced. A
  renderer never invents a plug posting to make the numbers tie.

## Account paths are canonical strings at the boundary

- Accounts are canonical colon-delimited path strings at every public API
  boundary: `Assets:Current:Cash-Maybank`, `Income:Sales`,
  `Expenses:Bank-Charges`.
- Numeric node IDs are an internal detail of the store. They never appear in a
  public argument, return value, event payload, or serialized output. If an ID
  leaks past the boundary, that is the bug.
- Path segments are compared and sorted as whole segments, never as substrings —
  `Assets:Cash` must not match `Assets:Cash-Reserve`.

## The engine boundary

- `@cynco/ledger-core` is a private engine. `@cynco/accounts` and
  `@cynco/journals` own the public product API.
- Package code, published payloads, and published manifests must never import or
  depend on `@cynco/ledger-core` or `@cynco/ledger-test-data`. The engine source
  is inlined into `@cynco/accounts` at build time (tsdown `noExternal`) and the
  leak is asserted after every build by
  `packages/accounts/scripts/assert-no-ledger-core.ts`.
- Do not "fix" a build/publish failure by re-adding the engine as a dependency.
  If the guard fires, the inlining or an import is wrong.

## Parsers degrade, they do not throw

- Parsers of source documents return `null` (or an explicit partial/flagged
  result) for absent or malformed values instead of throwing. A malformed
  statement line must not abort a whole import.

## Where the machinery enforces this

- `moonx accounts:test` / `moonx journals:test` — unit and integration suites
  that exercise balancing, canonical paths, and parsing.
- `packages/accounts/build` runs `assert-no-ledger-core.ts` on every build.
- The publish payload verification (`scripts/publish.ts`,
  `packages/accounts/scripts/assert-safe-publish.ts`) blocks any release that
  still references a private package.
