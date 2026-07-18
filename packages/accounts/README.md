# @cynco/accounts

Path-first account tree UI for the web.

`@cynco/accounts` ships one implementation through three public entry points:

- `@cynco/accounts` — vanilla model (`AccountTreeController`), mounting API
  (`AccountTree`), pure row renderer, theming, and core types
- `@cynco/accounts/react` — `<AccountTree options={...} />` and `useAccountTree`
- `@cynco/accounts/ssr` — `preloadAccountTreeHTML` for declarative-shadow-DOM
  SSR

The tree renders inside an `<accounts-container>` shadow root and keeps public
state keyed by canonical colon-delimited account paths
(`Assets:Current:Cash-Maybank`), never internal numeric IDs. Balances are
integer minor units end to end.

## Vanilla usage

```ts
import { AccountTree } from '@cynco/accounts';

const tree = new AccountTree({
  entries, // LedgerEntry[] — postings seed the tree and its balances
  currency: 'MYR',
  initialExpansion: 'top-level',
  density: 'compact',
});

tree.render(document.getElementById('mount')!);
```

Common methods:

- `tree.setEntries(entries)`, `tree.setAccountStatus(entries)`
- `tree.setExpanded(path, expanded)`, `tree.expandAll()`, `tree.collapseAll()`
- `tree.getSelectedPaths()`, `tree.getFocusedPath()`, `tree.onSelect(cb)`
- `tree.scrollToPath(path, { focus: true })`
- `tree.getController()` for the model layer (search sessions, focus, ranges)
- `tree.cleanUp()`

The tree also supports inline rename (F2 or double-click a selected row),
drag-and-drop re-parenting with Pierre-style guards (no self/descendant/parent
drops, batch multi-select moves, spring-loaded expansion), and
`flattenEmptyGroups` — single-child group chains collapse into one visible row
without ever touching canonical topology.

Status decorations are the git-status analog: colored dots (+ counts) on rows,
rolled up onto collapsed ancestors.

```ts
tree.setAccountStatus([
  { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 3 },
  { path: 'Liabilities:Current:AP', status: 'flagged' },
]);
```

## React usage

```tsx
'use client';

import { AccountTree } from '@cynco/accounts/react';

export function Chart({ entries }) {
  return (
    <AccountTree
      options={{ entries, currency: 'MYR' }}
      style={{ height: '320px' }}
    />
  );
}
```

## SSR

```tsx
import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';

const ssrHTML = await preloadAccountTreeHTML({ id: 'coa', entries });
// <AccountTree options={{ id: 'coa', entries }} ssrHTML={ssrHTML} />
```

The preload renders at most 512 leading rows (the deferred-projection cap); the
client adopts the shadow root without a rebuild and re-windows on first scroll.

## Styling

The shadow root reads `--accounts-*` custom properties with override → theme →
default chains:

- `--accounts-bg-override`, `--accounts-accent-override`, ...
- `--accounts-theme-*` — bind `@cynco/theme` roles with
  `accountsThemeVariables(roles)`
- `--accounts-density-scale-override` — density scale factor

`unsafeCSS` injects raw CSS into the `unsafe` layer as an escape hatch; prefer
the variable chains first.

## Development

```bash
moonx accounts:test
moonx accounts:typecheck
moonx accounts:build
moonx accounts:benchmark
```
