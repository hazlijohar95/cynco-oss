# @cynco/ledger-core

npm: [`@cynco/ledger-core`](https://www.npmjs.com/package/@cynco/ledger-core) ·
docs: <https://ledger.cynco.dev/docs/ledger-core>

The Cynco ledger engine, from [Cynco](https://github.com/hazlijohar95/cynco-oss)
— modern accounting infrastructure. This package is the foundation the rest of
the suite builds on: the double-entry data model, the integer-minor-unit money
kernel, the entry and account stores, and the trial balance / income statement /
balance sheet derivations. Pure data and math — no DOM, no CSS, no framework.

```ts
import { deriveTrialBalance, EntryStore } from '@cynco/ledger-core';

const store = new EntryStore(entries); // entries: LedgerEntry[]
const trialBalance = deriveTrialBalance(store.filterEntries({}));
```

## The data model

Every package in the suite speaks `LedgerEntry`: a dated, flagged journal entry
whose `postings` are signed integer minor units on canonical colon-delimited
account paths (`Assets:Current:Cash-Maybank`). Three invariants hold everywhere:

- Amounts are integer minor units (sen, cents). No floats ever touch money.
- Every entry balances: posting amounts per currency sum to exactly zero, or the
  entry is flagged — never silently repaired.
- Currencies never mix: balances, registers, and statements report per currency,
  and cross-currency translation is refused rather than guessed.

## What's inside

- `EntryStore` / `AccountStore` — in-memory stores with balance queries,
  filtering, register rows, and mutation events (chunked async ingest via a
  cooperative scheduler).
- `deriveTrialBalance`, `deriveIncomeStatement`, `deriveBalanceSheet` —
  statement derivations with working-trial-balance adjustment columns, contra
  accounts, and fiscal-year earnings splits.
- Account taxonomy — path-convention classification
  (assets/liabilities/equity/income/expenses) with per-path overrides;
  unclassifiable accounts are surfaced, never guessed into a section.
- Money kernel — safe minor-unit arithmetic, the canonical ISO 4217 minor-unit
  exponent table, and the shared `AmountFormat` presets every renderer formats
  with.
- Balance assertions, opening balance entries, and entry filters.

## License

MIT — see [LICENSE.md](./LICENSE.md).
