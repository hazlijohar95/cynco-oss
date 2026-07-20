# @cynco/accounts

Docs: <https://ledger.cynco.dev/docs/accounts> · npm:
[`@cynco/accounts`](https://www.npmjs.com/package/@cynco/accounts)

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

## Account icons

Rows can render an icon between the chevron and the name, resolved per row from
a **built-in, closed icon set** — `bank`, `cash`, `wallet`, `receivable`,
`payable`, `income`, `expense`, `equity`, `folder`, `chart`:

```ts
import { AccountTree, createDefaultAccountIconResolver } from '@cynco/accounts';

const tree = new AccountTree({
  entries,
  icons: { resolver: createDefaultAccountIconResolver() },
});

// Or your own resolver:
const custom = new AccountTree({
  entries,
  icons: {
    resolver({ path, name, isGroup, depth }) {
      if (isGroup) return 'folder';
      return path.startsWith('Assets:') ? 'wallet' : null; // null = no icon
    },
  },
});
```

- The resolver returns an `AccountIconName` or `null` (no icon — with the option
  absent, row markup is byte-identical to a tree without icons).
- **The closed union is the XSS boundary**: resolvers never return markup; the
  renderer only interpolates its own built-in SVG path data and validates the
  returned name at runtime, so untyped hosts cannot inject HTML through the icon
  lane.
- **Hot path contract**: the resolver runs once per rendered row per window
  commit (never per selection/focus patch). Keep it cheap and pure.
- Icons are decorative (`aria-hidden`), colored by `currentColor`, and sized by
  the density scale (`--accounts-icon-size`, override with
  `--accounts-icon-size-override`). Sticky mirror rows and renaming rows keep
  their icon.

`createDefaultAccountIconResolver()` is a pragmatic default over top-level
segment heuristics — replace it when you have real account-type metadata: groups
→ `folder`; Assets leaves → `cash` (name contains "cash"/"petty", checked first
so "Cash-Maybank" reads as cash), `bank`, `receivable` ("receivable"/"debtor"),
else `wallet`; Liabilities → `payable`; Income/Revenue → `income`; Expenses →
`expense`; Equity/Capital → `equity`; anything else → no icon.

## Row decorations

`renderDecorations` adds a host-driven trailing lane between the name and the
balance — small text badges and colored dots:

```ts
const tree = new AccountTree({
  entries,
  renderDecorations({ path, name, isGroup, depth, visibleChildCount }) {
    const count = postingCounts.get(path);
    return [
      ...(count ? [{ kind: 'text' as const, text: `${count}×` }] : []),
      ...(isStale(path)
        ? [{ kind: 'dot' as const, tone: 'warn' as const }]
        : []),
    ];
  },
});
```

- Decorations are **host-driven** and recomputed per window commit;
  controller-driven status dots (`setAccountStatus`, with ancestor roll-up) stay
  a separate lane right before them. Same hot-path contract as icon resolvers:
  cheap and pure.
- Tones (`neutral | info | success | warn | danger`) map onto the theme state
  colors (`--accounts-tone-*`, resolving through `--accounts-theme-states-*`;
  `neutral` uses the muted foreground).
- **At most 3 decorations render per row** — rows are fixed-height by contract
  (all virtualization math is `index * rowHeight`), and an unbounded lane would
  break that.
- Text decorations are escaped and contribute to the row's accessible name as
  ordinary text content; dots are `aria-hidden` (a bare colored circle has no
  announceable meaning).
- `visibleChildCount` is the number of child rows an expanded group currently
  contributes to the projection (0 for leaves and collapsed groups).

## Drop collision strategies & drop callbacks

`dropCollision` decides what happens when a dragged account's leaf name already
exists under the drop target:

```ts
const tree = new AccountTree({
  entries,
  dropCollision: 'skip', // 'reject' (default) | 'skip' | 'replace'
  onMove(moves) {
    /* fires first — the original event, unchanged */
  },
  onDropComplete({ moves, skipped, replaced }) {
    /* fires second — the richer superset */
  },
  onDropError({ reason, attempted }) {
    // reason: 'collision' | 'invalid-target' | 'self-drop'
  },
});
```

- **`reject`** (default): any collision blocks the whole drop — nothing moves,
  `onDropError` fires with `reason: 'collision'` and the full attempted batch.
  The colliding target still accepts the drop gesture so the error is surfaced
  instead of the cursor being silently refused.
- **`skip`**: colliding moves drop out of the plan; the rest proceed and
  `onDropComplete.skipped` lists what stayed put. When every candidate collides,
  the drop is a silent no-op (no event).
- **`replace`**: the existing account at each colliding destination — and its
  whole subtree — is removed, then the move proceeds. `onDropComplete.replaced`
  lists the removed roots. Removal runs through the same remap rebuild as the
  move itself: exactly one change event, selection/focus/status/search state on
  removed paths is dropped (never remapped), and **ledger entries with any
  posting inside a replaced subtree are dropped whole** (a partial entry would
  not balance) — sync your own store from the `replaced` list.

Ordering: `onMove` (back-compat, applied moves only) always fires before
`onDropComplete`. `onDropError` fires alone — an erroring drop applies nothing.
Programmatic movers can share the exact same path via the controller:
`applyMovePlan(planMovePaths(sources, target, collision))`;
`getMovePlan`/`movePaths` keep their original skip-shaped behavior.

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

## Lazy child loading

Huge charts (or remote ones) don't need every subtree up front. Mark groups as
_unloaded_ and give the tree an async loader; expanding an unloaded group
fetches its children on demand:

```ts
const tree = new AccountTree({
  accounts: ['Assets:Current:Cash', 'Archive'],
  initiallyUnloaded: ['Archive'],
  loadChildren: async (path) => {
    const response = await fetch(`/api/accounts?parent=${path}`);
    return response.json(); // canonical child paths, e.g. ['Archive:2024']
  },
  onChildLoadError(path, error) {
    console.warn(`loading ${path} failed`, error);
  },
});
```

**Contract.** An unloaded group renders as a collapsed, expandable group even
with zero children in the store — the chevron affordance is truthful because
"unloaded" _means_ "children exist but are unfetched". Expanding it (chevron
click, ArrowRight, programmatic `setExpanded`) starts exactly one load:
`loadChildren(path)` resolves to the group's canonical child paths (nested
descendants allowed; ancestors auto-create; invalid paths are skipped, the same
graceful semantics as every other path input). Loaded children then flow through
the normal projection/window pipeline. The controller surface is
`markUnloaded(paths)`, `getChildLoadState(path)`, `requestChildLoad(path)`, and
`cancelChildLoads()`.

**Loading & error UX.** While a fetch is in flight the group row carries
`aria-busy="true"` and an expanded group shows one fixed-height _loading row_
(CSS-animated dots honoring `prefers-reduced-motion`; `aria-hidden`, since the
group's `aria-busy` already tells assistive tech and no child rows exist yet to
fake `aria-setsize` for). A rejection swaps it for an _error row_ with the
failure message and a real, labelled **Retry** `<button>`. Placeholder rows are
projection-level view rows, not store rows: never selectable, never drag sources
or drop targets, and keyboard navigation / type-ahead skip them — with one
deliberate exception to the roving-tabindex pattern: the Retry button keeps
`tabindex="0"`, because the row is not a treeitem (aria-activedescendant can
never reach it) and the only recovery control must stay keyboard-reachable.
Collapsing and re-expanding an error group does **not** auto-retry; Retry (or
`requestChildLoad`) is the explicit gesture, so a failing endpoint is never
hammered by browsing.

**Expand-all never loads.** `expandAll()` skips unloaded groups by design: it is
ONE gesture, and fanning it out into N network fetches (one per unloaded group)
would be surprising, slow, and unbounded. Expand the specific group you want
fetched.

**Stale responses.** Each attempt carries a token (the same session-token idiom
as context-menu sessions): a load that settles after `cleanUp()`, after the
group was removed or moved (rename / drag & drop), or after a newer attempt for
the same path, is discarded instead of resurrecting rows the tree moved on from.
The store double-guards this — a completion for a machine no longer in `loading`
is refused with reason `not-loading`.

**Search & flatten.** Search cannot see unfetched children: under
`hide-non-matches` an unloaded group stays visible only when the group itself
matches. `flattenEmptyGroups` never flattens into or through a group with a
pending load — the placeholder needs an honest anchor row.

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
