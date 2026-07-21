# @cynco/statements

Docs: <https://ledger.cynco.dev/docs/statements> · npm:
[`@cynco/statements`](https://www.npmjs.com/package/@cynco/statements)

Trial balance and financial statement renderers derived from ledger entries.

`@cynco/statements` ships one implementation through two public entry points:

- `@cynco/statements` — statement derivations (`deriveTrialBalance`,
  `deriveIncomeStatement`, `deriveBalanceSheet`), the account taxonomy, the
  vanilla `TrialBalance` component, the pure HTML renderer, and core types
- `@cynco/statements/react` — `<TrialBalance data={...} />`

Statements render inside a `<statements-container>` shadow root as semantic
tables keyed by canonical colon-delimited account paths
(`Assets:Current:Cash-Maybank`). Amounts are integer minor units end to end and
format via digit-string slicing — no float ever touches a monetary value.
Out-of-balance sections render flagged, never repaired.

The data engine (`@cynco/ledger-core`) is inlined into the published bundle at
build time; the package has no runtime dependencies.

## Usage

```tsx
import { createAccountTaxonomy, deriveTrialBalance } from '@cynco/statements';
import { TrialBalance } from '@cynco/statements/react';

const data = deriveTrialBalance(entries, {
  taxonomy: createAccountTaxonomy(),
  asOf: '2026-06-30',
});

<TrialBalance data={data} colorScheme="system" />;
```

Vanilla, without React:

```ts
import { deriveTrialBalance, TrialBalance } from '@cynco/statements';

const view = new TrialBalance({ showClassification: true });
view.render({
  data: deriveTrialBalance(entries),
  parentNode: document.getElementById('mount')!,
});
```

The trial balance renders one table per currency (currencies are never mixed
into one column), with debit/credit columns, a totals proof line, abnormal- and
unclassified-row flags, and — when `adjustments` are configured — the six-column
working trial balance (unadjusted / adjustments / adjusted).
