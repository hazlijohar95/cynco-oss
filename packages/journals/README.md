# Journals, from Cynco

`@cynco/journals` is a framework-agnostic rendering library for journal entries
and account registers. Beautiful by default, virtualized for scale, and exact to
the minor unit — no floats ever touch an amount. Available as vanilla JavaScript
and React components.

## Features

- Journal entry cards with postings, tags, links, and flag states
- Virtualized single-account registers with running balances
- Ledger view stacking many registers behind one shared virtualizer, with
  incremental section reconciliation and scroll anchoring across data updates
- Smooth programmatic scrolling: a critically-damped spring engine behind
  `scrollToRow` / `scrollToDate` / `scrollToSection` (user input always wins;
  reduced motion always jumps)
- Sticky current-period labels on grouped registers (mirror-based, aria-hidden)
- Reconciliation: statement lines vs book postings with a deterministic matching
  engine (exact, date-window, and multi-posting sum passes) and
  accept/reject/undo resolution — merge-conflict UI for bank reconciliation
- Entry streaming: render entries live from a `ReadableStream` or
  `AsyncIterable`, rAF-batched, with stick-to-bottom autoscroll
- Optional worker pool (`@cynco/journals/worker`) that moves window rendering
  and match proposals off the main thread, with transparent main-thread fallback
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

## Scroll APIs

Every scroll-to API takes the same options:
`{ align?: 'start' | 'center' | 'nearest'; behavior?: 'smooth' | 'auto' }`.
`align` defaults to `nearest` for rows (minimal movement; a no-op when the row
is already visible) and `start` for sections; `start` accounts for the sticky
header overlaying the viewport top. `behavior` defaults to `auto` (instant) —
smooth is opt-in everywhere, and keyboard focus reveal stays instant so it never
lags typing.

```ts
register.scrollToRow(500, { align: 'center', behavior: 'smooth' });
register.scrollToDate('2026-03-01'); // First row dated on/after (binary search).
ledgerView.scrollToSection('Assets:Current:AR', { behavior: 'smooth' });
ledgerView.scrollToRow('Assets:Current:AR', 12, { align: 'start' });
```

Targets come from the same data-derived offsets the virtualizer uses (prefix
sums under grouping), so no layout reads happen before a scroll. Out-of-range
rows, unknown accounts, and dates past the last row are graceful no-ops.

### Smooth scroll settings

Smooth scrolling is a critically-damped spring (no overshoot, ever) driven
through the shared rAF queue. Tune it with
`SmoothScrollSettings = { omega, epsilonPx, epsilonVelocity }` — `omega` is
stiffness in rad/ms (99% settle ≈ `6.6 / omega`; the default `0.015` gives a
~440ms glide), and the epsilons gate when the spring settles and snaps exactly
onto the target. Pass `smoothScrollSettings` to `Register` / `LedgerView`
options, or use the `SmoothScroller` class directly for your own containers.
User input wins: wheel, touch, scrollbar drags, and scroll keys cancel an
in-flight animation instantly (listeners exist only while animating), and
`prefers-reduced-motion` turns every smooth scroll into an instant jump.

## LedgerView v2

`setSections(sections)` reconciles incrementally, keyed by account path:
unchanged sections keep their `Register` instance and DOM, data-changed sections
update in place (structural row equality, so fresh-but-identical arrays from
immutable stores are "unchanged"), added sections mount, removed sections clean
up, and order changes reorder DOM nodes without recreating anything. Focus and
selection are per-register state keyed by entry index, so they survive whenever
their section survives.

Across `setSections` the scroll position anchors to what the user sees: the
topmost visible section + entry row is captured before the update and restored
after, so sections growing/shrinking/appearing/disappearing above it never shift
the content in view. If the anchor section itself was removed, the nearest
surviving neighbor takes its place (preceding first, then following), falling
back to the raw scrollTop only when nothing survives.

### LedgerView SSR

```ts
import { preloadLedgerViewHTML } from '@cynco/journals/ssr';

const ssrHTML = await preloadLedgerViewHTML(sections, { id: 'ledger' });
// Client: pass the SAME id so ARIA row ids agree.
ledgerView = new LedgerView({ id: 'ledger' });
ledgerView.hydrate({ sections, container });
```

The preload emits the shared scroller, every section's sticky header, and each
section's leading rows — capped per section (128) and across the view (512
total, leading sections first) — with exactly sized spacers so the pre-hydration
scrollbar geometry matches the hydrated client. `hydrate` adopts the markup with
zero DOM rebuilds and falls back to `render` when the markup is missing. The
React wrapper takes `ssrHTML` just like `Register`.

## Sticky group labels

When `groupBy` is active, the current period's label pins as a slim strip just
below the register's sticky header (`stickyGroupLabels` defaults to true; pass
`false` to opt out). It is a mirror of the real group row — aria-hidden and
pointer-inert, because the real row inside the virtualized window carries the
grid semantics — updated from the prefix-sum row model in O(log n) per scroll
frame, with DOM writes only when the period changes. In a `LedgerView` it pins
below the owning section's sticky header.

## Register filter

`Register` takes a projection-level filter — the same philosophy as the accounts
tree's hide-non-matches search: canonical rows are never touched, only which
rows are _visible_ changes.

```ts
const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  filter: { query: 'coffee' }, // optional initial filter
  onFilterResult({ matched, total }) {
    readout.textContent = `${matched} of ${total}`;
  },
});
// ...later, per keystroke:
register.setFilter({ query: input.value });
register.setFilter(null); // clear
```

- **Matching** is a case-insensitive substring test on `fields` (default
  `['description']` — the payee/narration pair; `'date'` and `'flag'` opt in). A
  lazy lowercase corpus is built on the first application and reused across
  query changes; it drops on `setRows`.
- **Identity is full-data everywhere public**: selection, focus, callbacks,
  `scrollToRow`, and row ids keep their original entry indexes. The filter never
  mutates selection — filtered-out selected rows simply are not rendered until
  the filter releases them. `aria-rowcount` / `aria-rowindex` describe the
  presented (filtered) grid.
- **Grouping**: period headers survive only for periods containing matches, and
  their count / net-change summaries are recomputed over the matched rows — the
  summary describes what's shown, not the period's full total.
- **Highlighting**: matched substrings in text cells wrap in
  `<mark data-filter-match>` (themed via the match/accent color family, or the
  `--journals-bg-filter-match` override).
- **Keyboard** navigation walks matched rows only; if the focused row gets
  filtered out, focus clears and `aria-activedescendant` is removed.
- **Parity**: the filter crosses the worker protocol and the SSR preload
  (`preloadRegisterHTML(rows, { filter })`), so worker, sync, and server HTML
  stay byte-identical.
- An empty query or `null` is "no filter" and keeps the unfiltered fast path —
  no corpus, no model allocation.

## Live-region announcements

Dynamic surfaces announce state changes to screen readers through
visually-hidden `aria-live="polite"` regions (one per component instance, kept
OUTSIDE the re-rendered markup so re-renders never re-announce):

- **Reconciliation** announces the per-currency difference after every accept /
  reject / undo (e.g. `MYR difference 42.00`, or `All currencies reconciled` at
  zero) — one announcement per discrete state change. Pass
  `disableAnnouncements: true` when the host narrates reconciliation itself.
- **EntryStream** announces exactly two moments: stream start
  (`Streaming entries…`) and completion (`N entries loaded`). The visual footer
  count keeps ticking but is deliberately not a live region.

Live regions are created empty on both render and hydrate, so SSR output never
replays a stale announcement.

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
