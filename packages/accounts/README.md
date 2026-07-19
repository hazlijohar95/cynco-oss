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

## Context menu composition

The tree never renders a context menu itself — it owns triggering, target
normalization, positioning data, ARIA, and the focus lifecycle; **you** render
the menu (Radix, native `<dialog>`, hand-rolled) from `contextMenu.onOpen`:

```ts
const tree = new AccountTree({
  entries,
  contextMenu: {
    rowButton: true, // optional per-row "…" button lane
    onOpen(request: AccountTreeContextMenuRequest) {
      // request.path    — the row the menu is for
      // request.paths   — effective targets: the whole selection when the
      //                   row is part of the current multi-selection,
      //                   otherwise just [path] (DnD-style normalization)
      // request.anchor  — { x, y } pointer coords for right-click,
      //                   { rect: DOMRect } for keyboard / button opens
      // request.source  — 'pointer' | 'keyboard' | 'button'
      showMyMenu(request);
    },
  },
});
```

Triggers: right-click on a row (the row is focused and selected first when it
was not already in the selection), Shift+F10 and the dedicated ContextMenu key
(focused row, rect anchor), and — with `rowButton: true` — a trailing "Row
actions" button per row revealed on hover/focus-within. When configured, rows
carry `aria-haspopup="menu"`.

**The close contract.** Your menu MUST call `request.close()` when it dismisses:

- `close()` (default `restoreFocus: true`) returns focus to the tree and the
  originating row, re-materializing the row if virtualization evicted it.
- `close({ restoreFocus: false })` is the **rename handoff**: call it and then
  `tree.beginRename(request.path)` so the rename input keeps focus without the
  tree stealing it back.
- Exactly one session is live at a time. Opening a new menu supersedes the
  previous session, whose `close()` becomes a no-op — always safe to call.

Radix-style pseudo-example:

```tsx
const [menu, setMenu] = useState<AccountTreeContextMenuRequest | null>(null);

// options passed to <AccountTree options={{ contextMenu: { onOpen: setMenu } }} />

<DropdownMenu.Root
  open={menu != null}
  onOpenChange={(open) => {
    if (!open) {
      menu?.close(); // restoreFocus: true — back to the row
      setMenu(null);
    }
  }}
>
  <DropdownMenu.Content
    style={positionFromAnchor(menu?.anchor)}
    onEscapeKeyDown={() => {
      /* onOpenChange(false) runs close() */
    }}
  >
    <DropdownMenu.Item
      onSelect={() => {
        const path = menu!.path;
        menu!.close({ restoreFocus: false }); // the rename handoff
        setMenu(null);
        treeRef.current!.beginRename(path);
      }}
    >
      Rename
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => archive(menu!.paths)}>
      Archive {menu!.paths.length} account(s)
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>;
```

## Search modes & match navigation

`AccountTreeController.beginSearch(query, options?)` runs a case-insensitive
substring match against each path segment and starts (or refines) a search
session. The expansion state from before the session is snapshotted once and
restored exactly by `endSearch()`. `options.mode` picks how matches reshape the
tree:

- `expand-matches` (default) — ancestors of every match auto-expand so matches
  are visible; everything else keeps its expansion.
- `collapse-non-matches` — additionally collapses every group with no match in
  its subtree: the minimal expansion revealing all matches.
- `hide-non-matches` — the visible projection is filtered to matches plus their
  ancestors. Projection-level only (like `flattenEmptyGroups`): canonical
  topology is untouched, and `aria-posinset` / `aria-setsize` are recomputed
  over the _filtered_ visible siblings so assistive tech never hears counts for
  rows that are not there.

```ts
const controller = tree.getController();
controller.beginSearch('cash', { mode: 'hide-non-matches' });
controller.focusNextSearchMatch(); // cyclic, projection order
controller.focusPreviousSearchMatch();
controller.getSearchMatchState(); // { index: 1, total: 2 } — 1-based, or null
controller.endSearch(); // restores the pre-search expansion
```

While a session is active, **F3** / **Shift+F3** on the tree step to the next /
previous match (IME-guarded like every other key). Hosts building a search input
should call `focusNextSearchMatch` / `focusPreviousSearchMatch` on the
controller directly and render `getSearchMatchState()` as the `{index}/{total}`
readout. Search mutations report an honest `searchChanged` facet on `onChange`
events.

## Middle name truncation

Deep charts produce names (and flattened chain labels) longer than the row.
`nameTruncation: 'end'` (default) keeps plain CSS ellipsis; `'middle'` turns on
measured middle truncation:

```ts
const tree = new AccountTree({ entries, nameTruncation: 'middle' });
```

After every window commit — and on container resize — the view measures the
rendered name elements in one batched pass (all reads, then all writes: at most
one reflow) and rewrites only the overflowing ones as `head…tail`, keeping the
leaf's tail visible since account names distinguish at the end (`Ve…-Maybank`,
not `VeryLongAcc…`). Truncated rows (and only those) carry `title` with the full
name. Selection/focus-only patches skip the pass. The full name always stays in
controller state — inline rename edits the real name, never the truncated
presentation text.

## Sticky ancestor stack

The sticky header mirrors the top visible row's off-screen ancestor(s) above the
tree. `stickyAncestors: 'nearest'` (default) shows the single nearest ancestor;
`'stack'` shows the whole breadcrumb:

```ts
const tree = new AccountTree({ entries, stickyAncestors: 'stack' });
```

The stack renders up to 4 mirror rows (nearest ancestors win — unbounded sticky
stacks would eat the viewport), visually identical to real rows but
`aria-hidden` with no treeitem semantics, and clicking a mirror scrolls to and
focuses the real ancestor row. Under `flattenEmptyGroups` and `hide-non-matches`
the stack follows the _visible_-parent chain, so hidden mid-chain groups never
appear. The scroller's spacer math accounts for the stack height, keeping
virtualized rows at exact pixel positions.

## IME input

Every keydown surface (navigation, type-ahead, the rename editor) ignores events
that belong to an active IME composition (`event.isComposing`, or the legacy
`keyCode === 229` older engines report). Enter during composition confirms the
IME candidate — it never commits a rename — and Escape dismisses the candidate
without cancelling the rename session.

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
