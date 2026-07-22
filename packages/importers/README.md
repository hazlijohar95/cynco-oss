# Importers, from Cynco

Docs: <https://ledger.cynco.dev/docs/importers> · npm:
[`@cynco/importers`](https://www.npmjs.com/package/@cynco/importers)

`@cynco/importers` turns raw bank exports (CSV, OFX 1.x/2.x) into the statement
lines and draft ledger entries the rest of the Cynco suite consumes. Pure data,
no DOM, no third-party dependencies — and exact to the minor unit: amounts are
parsed straight from decimal strings to integer minor units, so no float ever
touches money.

## Features

- CSV parsing under an explicit column mapping — delimiter, date format, and
  decimal/group separators are declared, never sniffed
- Quoted fields with embedded delimiters, escaped quotes, and newlines; CRLF
- Single signed amount column or split debit/credit columns
- OFX 1.x (SGML) and 2.x (XML) via one tolerant tag scanner — no XML dependency
- Multiple statements per OFX file, returned as per-account groups
- Running-balance proof against the source's own balance column, reporting every
  break with its exact location
- Draft entry generation: balanced `pending` entries with a suspense
  counterposting and deterministic ids, stable across reruns
- Skip-with-reason: malformed rows land in `skipped`, never silently dropped;
  structurally broken files throw a typed `ImportError`

## Install

```bash
pnpm add @cynco/importers
```

## CSV

```ts
import {
  parseCsvStatement,
  proveRunningBalance,
  toDraftEntries,
} from '@cynco/importers';

const { lines, skipped } = parseCsvStatement(csvText, {
  delimiter: ';',
  columns: {
    date: 'Date',
    description: 'Description',
    amount: { debit: 'Debit', credit: 'Credit' },
    balance: 'Balance',
  },
  dateFormat: 'DD/MM/YYYY',
  amountFormat: { decimal: ',', group: '.' },
  currency: 'MYR',
});

const proof = proveRunningBalance(lines); // { ok: true } or every break, located
const drafts = toDraftEntries(lines, {
  account: 'Assets:Current:Cash-Maybank',
  suspenseAccount: 'Equity:Suspense',
});
```

## OFX

```ts
import { parseOfx, toDraftEntries } from '@cynco/importers';

const { statements, skipped } = parseOfx(ofxText, { defaultCurrency: 'MYR' });
for (const { accountId, currency, lines } of statements) {
  // lines are StatementLine-shaped: they feed @cynco/journals reconciliation as-is.
}
```

## Fail loud

Importers never invent or repair data. A row the parser cannot trust is skipped
with a reason; a file the parser cannot trust throws an `ImportError` with a
machine-readable `code`; a running balance that does not tie is reported break
by break, never plugged. Ambiguity is rejected up front: date and amount formats
are explicit in the mapping because a wrong guess corrupts an entire import
silently.

## Development

We use pnpm for workspace package management and Bun for tests.

```bash
# From the root of the monorepo: setup dependencies
pnpm install

# Run tests from within the package directory
bun test

# Type checking
moonx importers:typecheck
```

## Publishing

**Applicable to the Cynco team only.**

```bash
# Always run publish from within the package directory.
cd packages/importers
pnpm publish
# In a CI-marked shell: CI= pnpm publish
```
