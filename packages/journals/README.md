# Journals, from Cynco

`@cynco/journals` is a framework-agnostic rendering library for journal entries
and account registers. Beautiful by default, virtualized for scale, and exact to
the minor unit — no floats ever touch an amount. Available as vanilla JavaScript
and React components.

## Features

- Journal entry cards with postings, tags, links, and flag states
- Virtualized single-account registers with running balances
- Ledger view stacking many registers behind one shared virtualizer
- Debit/credit semantics styled like diff additions/deletions
- Unbalanced entries flagged inline, never silently repaired
- Light and dark from one DOM via `light-dark()`; themable through
  `@cynco/theme` roles or per-site CSS variable overrides
- SSR via declarative shadow DOM with zero-write hydration

## Install

```bash
pnpm add @cynco/journals
```

## Usage

```ts
import { JournalEntry } from '@cynco/journals';

const entry = new JournalEntry({ showLineNumbers: true });
entry.render({ entry: ledgerEntry, parentNode: document.body });
```

```tsx
import { Register } from '@cynco/journals/react';

<Register rows={rows} options={{ account: 'Assets:Current:Cash-Maybank' }} />;
```

```ts
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';

const ssrHTML = await preloadJournalEntryHTML(ledgerEntry);
```

## Development

We use pnpm for workspace package management and Bun for tests.

```bash
# From the root of the monorepo: setup dependencies
pnpm install

# Run tests from within the package directory
bun test

# Type checking
moonx journals:typecheck

# Benchmarks
moonx journals:benchmark
```

Tests are located in the `test/` folder and use Bun's native testing framework
with snapshot support.

## Publishing

**Applicable to the Cynco team only.**

```bash
# Always run publish from within the package directory.
cd packages/journals
pnpm publish
# In a CI-marked shell: CI= pnpm publish
```
