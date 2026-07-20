import '@/app/prose.css';
import type { Metadata } from 'next';

import { AccountTreeDocsDemo } from './AccountTreeDocsDemo';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Accounts docs';
const docsDescription =
  'Documentation for @cynco/accounts: vanilla and React APIs, SSR ' +
  'hydration, theming, and virtualization for the chart-of-accounts tree.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

const VANILLA_API = `
import { AccountTree } from '@cynco/accounts';

const tree = new AccountTree({
  entries,                    // postings seed the tree and its balances
  accounts: [                 // zero-activity accounts to include anyway
    'Equity:Retained-Earnings',
  ],
  initialExpansion: 'top-level', // 'all' | 'top-level' | string[]
  density: 'default',            // 'compact' 24px | 'default' 30px | 'relaxed' 36px
  currency: 'MYR',               // primary display currency
  onSelect(selectedPaths, focusedPath) {
    console.log(selectedPaths, focusedPath);
  },
});

tree.render(document.querySelector('#host')!);

// Data changes go through the imperative API, not options:
tree.setEntries(nextEntries);
tree.setAccountStatus([
  { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 4 },
]);
tree.setExpanded('Expenses', false);
tree.scrollToPath('Liabilities:Current:SST-Payable', { focus: true });
tree.cleanUp();
`;

const CONTROLLER_API = `
// The controller is the headless model behind the view — use it for
// programmatic reads without touching the DOM.
const controller = tree.getController();

controller.getVisibleCount();      // rows currently visible
controller.getRows(0, 50);         // materialized AccountTreeRowData slice
controller.selectPath('Assets:Current', { additive: true });
controller.beginSearch('cash');    // expands ancestors of every match
`;

const REACT_API = `
import { AccountTree } from '@cynco/accounts/react';

export function ChartOfAccounts({ entries }: { entries: LedgerEntry[] }) {
  return (
    <AccountTree
      options={{
        entries,
        currency: 'MYR',
        initialExpansion: 'top-level',
        flattenEmptyGroups: true,
        onSelect: (paths, focused) => setSelected(paths),
      }}
      onRename={(oldPath, newPath) => console.log(oldPath, '→', newPath)}
      onMove={(moves) => console.log(moves)}
      style={{ height: 420 }}
    />
  );
}
`;

const REACT_HOOK = `
import { templateRender, useAccountTree } from '@cynco/accounts/react';

// The hook variant exposes the vanilla instance for imperative calls
// (setAccountStatus, scrollToPath, …).
export function DecoratedTree({ entries, ssrHTML }: Props) {
  const { ref, getInstance } = useAccountTree({ id: 'coa', entries });

  useEffect(() => {
    getInstance()?.setAccountStatus(statusEntries);
  }, [getInstance]);

  return (
    <accounts-container ref={ref} style={{ height: 420 }}>
      {templateRender(null, ssrHTML)}
    </accounts-container>
  );
}
`;

const SSR_EXAMPLE = `
// Server component
import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';

const ssrHTML = await preloadAccountTreeHTML({
  id: 'coa', // must match the client id so hydrated row ids line up
  entries,
  currency: 'MYR',
  initialExpansion: 'top-level',
  initialWindowRows: 64, // leading window; capped at 512
});
`;

const THEMING_CHAIN = `
/* Every color resolves override → theme → built-in default: */
--accounts-bg: var(
  --accounts-bg-override,
  var(--accounts-theme-bg-editor, light-dark(#ffffff, #0a0a0a))
);
`;

const THEMING_OVERRIDE = `
accounts-container {
  --accounts-font-family: var(--font-mono);
  --accounts-accent-override: #009fff;
  --accounts-row-height-override: 28px;
  --accounts-status-unreconciled-override: #d5a910;
}
`;

const STATUS_EXAMPLE = `
tree.setAccountStatus([
  // kind decides the dot color (warn / danger / info); counts roll up
  // onto collapsed ancestor groups.
  { path: 'Assets:Current:Cash-Maybank', status: 'unreconciled', count: 4 },
  { path: 'Assets:Current:AR', status: 'pending', count: 2 },
  { path: 'Liabilities:Current:SST-Payable', status: 'flagged' },
]);
`;

const ICONS_EXAMPLE = `
import { AccountTree, createDefaultAccountIconResolver } from '@cynco/accounts';

const tree = new AccountTree({
  entries,
  icons: { resolver: createDefaultAccountIconResolver() },
});

// Or your own resolver — return a built-in name, or null for no icon:
const custom = new AccountTree({
  entries,
  icons: {
    resolver({ path, name, isGroup, depth }) {
      if (isGroup) return 'folder';
      return path.startsWith('Assets:') ? 'wallet' : null;
    },
  },
});
`;

const DECORATIONS_EXAMPLE = `
const tree = new AccountTree({
  entries,
  renderDecorations({ path, name, isGroup, depth, visibleChildCount }) {
    const count = postingCounts.get(path);
    return [
      ...(count ? [{ kind: 'text' as const, text: \`\${count}×\` }] : []),
      ...(isStale(path)
        ? [{ kind: 'dot' as const, tone: 'warn' as const }]
        : []),
    ];
  },
});
`;

const FLATTEN_EXAMPLE = `
const tree = new AccountTree({
  entries,
  flattenEmptyGroups: true, // 'Income' + 'Income:Sales' → one 'Income : Sales' row
});

// Live projection toggle — no rebuild, expansion state untouched:
tree.setFlattenEmptyGroups(false);

// The flattened row represents its deepest group; every public API keeps
// canonical paths:
tree.setExpanded('Income:Sales', false); // toggles the chain's row
const controller = tree.getController();
controller.getPathIndex('Income');       // -1: mid-chain paths have no row
controller.getRow('Income:Sales')?.flattenedNames; // ['Income', 'Sales']
`;

const RENAME_EXAMPLE = `
// View: F2 (focused row) or double-click an already-selected row opens the
// inline editor. Enter commits, Escape cancels, blur commits. The editor
// survives virtualization: session + draft live in the controller and the
// input re-attaches when the row re-enters the window.
const tree = new AccountTree({
  entries,
  onRename(oldPath, newPath) {
    console.log(oldPath, '→', newPath); // 'Assets:Current' → 'Assets:Ops'
  },
});
tree.beginRename('Assets:Current'); // programmatic entry point

// Controller: validation + remap without any DOM.
const controller = tree.getController();
controller.beginRename('Assets:Current');
controller.setRenameDraft('Ops');
const result = controller.commitRename('Assets:Current', 'Ops');
// { ok: true, newPath: 'Assets:Ops' } — descendants, balances, expansion,
// selection, focus, and status decorations all follow the remap.
// Failures: { ok: false, reason: 'unknown-path' | 'invalid-name' | 'collision' }
controller.cancelRename();
`;

const DND_EXAMPLE = `
// Rows are HTML5 drag sources; group rows are drop targets. Guards:
// no self-drops, no drops into an own descendant, drops on
// the current parent are no-ops, and leaf-name collisions at the target are
// skipped. Dragging a selected row moves the whole selection (descendants
// of dragged groups ride along); hovering a collapsed group for 700ms
// spring-loads it open.
const tree = new AccountTree({
  entries,
  onMove(moves) {
    // [{ from: 'Assets:Current:Cash-Wise', to: 'Assets:Reserve:Cash-Wise' }]
  },
  dragExpandDelayMs: 700, // spring-load delay override
});

// The same machinery, programmatically:
const controller = tree.getController();
controller.getMovePlan(['Assets:Current:Cash-Wise'], 'Assets:Reserve'); // dry run
controller.movePaths(['Assets:Current:Cash-Wise'], 'Assets:Reserve');  // applies + fires onMove
`;

const DROP_COLLISION_EXAMPLE = `
const tree = new AccountTree({
  entries,
  dropCollision: 'skip', // 'reject' (default) | 'skip' | 'replace'
  onMove(moves) {
    // fires first — the original event, applied moves only
  },
  onDropComplete({ moves, skipped, replaced }) {
    // fires second — the richer superset
  },
  onDropError({ reason, attempted }) {
    // reason: 'collision' | 'invalid-target' | 'self-drop'
  },
});

// Programmatic movers share the exact same path via the controller:
const controller = tree.getController();
controller.applyMovePlan(
  controller.planMovePaths(sources, target, 'replace')
);
`;

const LAZY_LOADING_EXAMPLE = `
const tree = new AccountTree({
  accounts: ['Assets:Current:Cash', 'Archive'],
  initiallyUnloaded: ['Archive'],
  loadChildren: async (path) => {
    const response = await fetch(\`/api/accounts?parent=\${path}\`);
    return response.json(); // canonical child paths, e.g. ['Archive:2024']
  },
  onChildLoadError(path, error) {
    console.warn(\`loading \${path} failed\`, error);
  },
});
`;

const CONTEXT_MENU_EXAMPLE = `
// The tree never renders a menu itself — it owns triggering, target
// normalization, positioning data, ARIA, and the focus lifecycle; the
// host renders whatever menu it likes (Radix, native, hand-rolled).
const tree = new AccountTree({
  entries,
  contextMenu: {
    rowButton: true, // optional per-row "…" button lane
    onOpen(request: AccountTreeContextMenuRequest) {
      // request.path   — the row the menu is for
      // request.paths  — effective targets: the whole selection when the
      //                  row is part of the current multi-selection,
      //                  otherwise just [path] (DnD-style normalization)
      // request.anchor — { x, y } pointer coords for right-click,
      //                  { rect: DOMRect } for keyboard / button opens
      // request.source — 'pointer' | 'keyboard' | 'button'
      showMyMenu(request);
    },
  },
});
`;

const CONTEXT_MENU_HOST = `
// A realistic host menu (Radix-style). The menu MUST call request.close()
// when it dismisses:
<DropdownMenu.Root
  open={menu != null}
  onOpenChange={(open) => {
    if (!open) {
      menu?.close(); // restoreFocus: true — back to the originating row
      setMenu(null);
    }
  }}
>
  <DropdownMenu.Content style={positionFromAnchor(menu?.anchor)}>
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
</DropdownMenu.Root>
`;

const SEARCH_EXAMPLE = `
const controller = tree.getController();

// Case-insensitive substring match against each path segment. The
// expansion state from before the session is snapshotted once and
// restored exactly by endSearch().
controller.beginSearch('cash', { mode: 'hide-non-matches' });
// mode: 'expand-matches' (default) | 'collapse-non-matches'
//     | 'hide-non-matches'

controller.focusNextSearchMatch();     // cyclic, projection order
controller.focusPreviousSearchMatch();
controller.getSearchMatchState(); // { index: 1, total: 2 } — 1-based,
                                  // or null with no active session
controller.endSearch(); // restores the pre-search expansion
`;

const STICKY_STACK_EXAMPLE = `
const tree = new AccountTree({
  entries,
  stickyAncestors: 'stack', // 'nearest' (default) | 'stack'
});
`;

const TRUNCATION_EXAMPLE = `
const tree = new AccountTree({
  entries,
  nameTruncation: 'middle', // 'end' (default) | 'middle'
});
`;

export default function AccountsDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <h1>Accounts</h1>
            <p>
              <code>@cynco/accounts</code> renders the chart of accounts as a
              virtualized, keyboard-navigable tree — rolled-up balances, status
              dots, search — into an <code>&lt;accounts-container&gt;</code>{' '}
              custom element with an open shadow root. Account paths are
              canonical colon-delimited strings at every public boundary;
              numeric node ids never leak out of the store.
            </p>
            <AccountTreeDocsDemo />

            <h2 id="installation">Installation</h2>
            <p>
              Install with the package manager of your choice. React is an
              optional peer dependency.
            </p>
            <CodeBlock code="pnpm add @cynco/accounts" />
            <table>
              <thead>
                <tr>
                  <th>Entry point</th>
                  <th>What it exports</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>@cynco/accounts</code>
                  </td>
                  <td>
                    The vanilla <code>AccountTree</code> view, the headless{' '}
                    <code>AccountTreeController</code>, pure renderers, and
                    utilities like <code>createDefaultAccountIconResolver</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/accounts/react</code>
                  </td>
                  <td>
                    <code>&lt;AccountTree /&gt;</code> plus the{' '}
                    <code>useAccountTree</code> hook for imperative access
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/accounts/ssr</code>
                  </td>
                  <td>
                    <code>preloadAccountTreeHTML</code> for server prerendering
                  </td>
                </tr>
              </tbody>
            </table>

            <h2 id="vanilla-api">Vanilla API</h2>
            <p>
              Construct with options, mount with <code>render</code>, then drive
              data changes through the imperative API. Selection follows
              file-tree conventions: click, meta-click (additive), shift-click
              (range), and full keyboard navigation with{' '}
              <code>aria-activedescendant</code>.
            </p>
            <CodeBlock code={VANILLA_API} />
            <CodeBlock code={CONTROLLER_API} />

            <h2 id="status-decorations">Status decorations</h2>
            <p>
              Status dots are the accounting analog of git file status:
              unreconciled, flagged, or pending, with an optional item count.
              Collapsed ancestor groups roll up the highest-severity status of
              their descendants, so nothing hides below the fold.
            </p>
            <CodeBlock code={STATUS_EXAMPLE} />

            <h2 id="account-icons">Account icons</h2>
            <p>
              Rows can render an icon between the chevron and the name, resolved
              per row from a built-in, <em>closed</em> icon set. The resolver
              returns an <code>AccountIconName</code> or <code>null</code> (no
              icon — with the <code>icons</code> option absent, row markup is
              byte-identical to a tree without icons).
            </p>
            <CodeBlock code={ICONS_EXAMPLE} />
            <p>
              <strong>The closed union is the XSS boundary</strong>: resolvers
              never return markup; the renderer only interpolates its own
              built-in SVG path data and validates the returned name at runtime,
              so untyped hosts cannot inject HTML through the icon lane. And the{' '}
              <strong>hot-path contract</strong>: the resolver runs once per
              rendered row per window commit — never per selection/focus patch —
              so keep it cheap and pure (same input, same output, no I/O). Icons
              are decorative (<code>aria-hidden</code>), colored by{' '}
              <code>currentColor</code>, and sized by the density scale (
              <code>--accounts-icon-size</code>, override with{' '}
              <code>--accounts-icon-size-override</code>). Sticky mirror rows
              and renaming rows keep their icon.
            </p>
            <p>
              <code>createDefaultAccountIconResolver()</code> is a pragmatic
              default over top-level segment heuristics — replace it when you
              have real account-type metadata:
            </p>
            <table>
              <thead>
                <tr>
                  <th>Icon</th>
                  <th>Default resolver assignment</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>folder</code>
                  </td>
                  <td>Every group, any depth — groups read as containers.</td>
                </tr>
                <tr>
                  <td>
                    <code>cash</code>
                  </td>
                  <td>
                    Assets leaves whose name contains &ldquo;cash&rdquo; or
                    &ldquo;petty&rdquo; — checked first, so{' '}
                    <code>Cash-Maybank</code> reads as cash held at a bank.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>bank</code>
                  </td>
                  <td>Assets leaves whose name contains &ldquo;bank&rdquo;.</td>
                </tr>
                <tr>
                  <td>
                    <code>receivable</code>
                  </td>
                  <td>
                    Assets leaves whose name contains &ldquo;receivable&rdquo;
                    or &ldquo;debtor&rdquo;.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>wallet</code>
                  </td>
                  <td>Every other Assets leaf.</td>
                </tr>
                <tr>
                  <td>
                    <code>payable</code>
                  </td>
                  <td>Liabilities leaves.</td>
                </tr>
                <tr>
                  <td>
                    <code>income</code>
                  </td>
                  <td>Income / Revenue leaves.</td>
                </tr>
                <tr>
                  <td>
                    <code>expense</code>
                  </td>
                  <td>Expenses leaves.</td>
                </tr>
                <tr>
                  <td>
                    <code>equity</code>
                  </td>
                  <td>Equity / Capital leaves.</td>
                </tr>
                <tr>
                  <td>
                    <code>chart</code>
                  </td>
                  <td>
                    Never assigned by the default resolver — available to custom
                    resolvers.
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              Leaves under any other top-level segment get no icon — the same
              look as an unresolved row.
            </p>

            <h2 id="row-decorations">Row decorations</h2>
            <p>
              <code>renderDecorations</code> adds a host-driven trailing lane
              between the name and the balance — small text badges and colored
              dots. Decorations are recomputed per window commit;
              controller-driven status dots (<code>setAccountStatus</code>, with
              ancestor roll-up) stay a separate lane right before them. Same
              hot-path contract as icon resolvers: cheap and pure.
            </p>
            <CodeBlock code={DECORATIONS_EXAMPLE} />
            <ul>
              <li>
                Tones (<code>neutral | info | success | warn | danger</code>)
                map onto the theme state colors (<code>--accounts-tone-*</code>,
                resolving through <code>--accounts-theme-states-*</code>;{' '}
                <code>neutral</code> uses the muted foreground).
              </li>
              <li>
                <strong>At most 3 decorations render per row</strong> — rows are
                fixed-height by contract (all virtualization math is{' '}
                <code>index * rowHeight</code>), and an unbounded lane would
                break that.
              </li>
              <li>
                Text decorations are escaped and contribute to the row&rsquo;s
                accessible name as ordinary text content; dots are{' '}
                <code>aria-hidden</code> (a bare colored circle has no
                announceable meaning).
              </li>
              <li>
                <code>visibleChildCount</code> is the number of child rows an
                expanded group currently contributes to the projection (0 for
                leaves and collapsed groups).
              </li>
            </ul>

            <h2 id="flattening">Flattening empty groups</h2>
            <p>
              <code>flattenEmptyGroups</code> collapses single-child group
              chains into one row labelled with the joined segments (
              <code>Income : Sales</code>, separators in punctuation color). It
              is purely a projection feature: canonical topology, expansion
              state, selection, and focus all keep canonical colon-delimited
              paths, and the flattened row stands in for its deepest group —
              expanding or collapsing the row toggles that node.{' '}
              <code>aria-posinset</code>/<code>aria-setsize</code> follow the
              visible projection, and the row shows the deepest group&rsquo;s
              rolled balance.
            </p>
            <CodeBlock code={FLATTEN_EXAMPLE} />

            <h2 id="rename">Inline rename</h2>
            <p>
              Press <kbd>F2</kbd> on the focused row or double-click an
              already-selected row to rename it in place. Names are validated
              (non-empty, no <code>:</code>, no sibling collision); a commit
              remaps the account and its whole subtree — postings, rolled
              balances, expansion, selection, focus, and status decorations
              follow. The remap rebuilds the path-derived store from remapped
              entries (single-digit milliseconds at 10k entries).
            </p>
            <CodeBlock code={RENAME_EXAMPLE} />

            <h2 id="drag-drop">Drag &amp; drop re-parenting</h2>
            <p>
              Drag a leaf or a group onto a group row to re-parent it — dropping{' '}
              <code>Assets:Current:Cash-Wise</code> on{' '}
              <code>Assets:Reserve</code> yields{' '}
              <code>Assets:Reserve:Cash-Wise</code>, subtree included. The
              dragged rows dim; a valid target shows the accent-subtle tint with
              a 1px accent inset ring; invalid targets show nothing.
            </p>
            <CodeBlock code={DND_EXAMPLE} />

            <h2 id="drop-collision">Drop collision strategies</h2>
            <p>
              <code>dropCollision</code> decides what happens when a dragged
              account&rsquo;s leaf name already exists under the drop target:
            </p>
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Behavior</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>reject</code> (default)
                  </td>
                  <td>
                    Any collision blocks the whole drop — nothing moves,{' '}
                    <code>onDropError</code> fires with{' '}
                    <code>reason: &apos;collision&apos;</code> and the full
                    attempted batch. The colliding target still accepts the drop
                    gesture so the error is surfaced instead of the cursor being
                    silently refused.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>skip</code>
                  </td>
                  <td>
                    Colliding moves drop out of the plan; the rest proceed and{' '}
                    <code>onDropComplete.skipped</code> lists what stayed put.
                    When every candidate collides, the drop is a silent no-op
                    (no event).
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>replace</code>
                  </td>
                  <td>
                    The existing account at each colliding destination — and its
                    whole subtree — is removed, then the move proceeds.{' '}
                    <code>onDropComplete.replaced</code> lists the removed
                    roots.
                  </td>
                </tr>
              </tbody>
            </table>
            <CodeBlock code={DROP_COLLISION_EXAMPLE} />
            <p>
              Under <code>replace</code>, removal runs through the same remap
              rebuild as the move itself: exactly one change event;
              selection/focus/status/search state on removed paths is dropped
              (never remapped); and ledger entries with any posting inside a
              replaced subtree are dropped whole (a partial entry would not
              balance) — sync your own store from the <code>replaced</code>{' '}
              list. Ordering: <code>onMove</code> (back-compat, applied moves
              only) always fires before <code>onDropComplete</code>;{' '}
              <code>onDropError</code> fires alone — an erroring drop applies
              nothing. <code>getMovePlan</code> / <code>movePaths</code> keep
              their original skip-shaped behavior.
            </p>

            <h2 id="context-menus">Context menus</h2>
            <p>
              Context menus are a composition surface, not a widget. Triggers:
              right-click on a row (the row is focused and selected first when
              it was not already in the selection), <kbd>Shift</kbd>+
              <kbd>F10</kbd> and the dedicated ContextMenu key (focused row,
              rect anchor), and — with <code>rowButton: true</code> — a trailing
              &ldquo;Row actions&rdquo; button per row revealed on hover /
              focus-within. When configured, rows carry{' '}
              <code>aria-haspopup=&quot;menu&quot;</code>.
            </p>
            <CodeBlock code={CONTEXT_MENU_EXAMPLE} />
            <p>
              The close contract: <code>close()</code> (default{' '}
              <code>restoreFocus: true</code>) returns focus to the tree and the
              originating row, re-materializing the row if virtualization
              evicted it. <code>close(&#123; restoreFocus: false &#125;)</code>{' '}
              is the <em>rename handoff</em>: call it and then{' '}
              <code>tree.beginRename(request.path)</code> so the rename input
              keeps focus without the tree stealing it back. Exactly one session
              is live at a time — opening a new menu supersedes the previous
              session, whose <code>close()</code> becomes a no-op, so a late
              close is always safe.
            </p>
            <CodeBlock code={CONTEXT_MENU_HOST} />

            <h2 id="search">Search modes &amp; match navigation</h2>
            <p>
              <code>beginSearch(query, options?)</code> starts (or refines) a
              search session; <code>options.mode</code> picks how matches
              reshape the tree. <code>expand-matches</code> (default)
              auto-expands ancestors of every match;{' '}
              <code>collapse-non-matches</code> additionally collapses every
              group with no match in its subtree — the minimal expansion
              revealing all matches; <code>hide-non-matches</code> filters the
              visible projection to matches plus their ancestors.{' '}
              <code>hide-non-matches</code> is projection-level only (like{' '}
              <code>flattenEmptyGroups</code>): canonical topology is untouched,
              and <code>aria-posinset</code> / <code>aria-setsize</code> are
              recomputed over the <em>filtered</em> visible siblings, so
              assistive tech never hears counts for rows that are not there.
            </p>
            <CodeBlock code={SEARCH_EXAMPLE} />
            <p>
              While a session is active, <kbd>F3</kbd> / <kbd>Shift</kbd>+
              <kbd>F3</kbd> on the tree step to the next / previous match
              (IME-guarded like every other key). Hosts building a search input
              should call the controller&rsquo;s{' '}
              <code>focusNextSearchMatch</code> /{' '}
              <code>focusPreviousSearchMatch</code> directly and render{' '}
              <code>getSearchMatchState()</code> as the{' '}
              <code>&#123;index&#125;/&#123;total&#125;</code> readout. Search
              mutations report an honest <code>searchChanged</code> facet on{' '}
              <code>onChange</code> events, so hosts can track match decorations
              without inferring them from expansion changes.
            </p>

            <h2 id="lazy-loading">Lazy child loading</h2>
            <p>
              Huge charts (or remote ones) don&rsquo;t need every subtree up
              front. Mark groups as <em>unloaded</em> and give the tree an async
              loader; expanding an unloaded group fetches its children on
              demand:
            </p>
            <CodeBlock code={LAZY_LOADING_EXAMPLE} />
            <p>
              An unloaded group renders as a collapsed, expandable group even
              with zero children in the store — the chevron affordance is
              truthful because &ldquo;unloaded&rdquo; <em>means</em>{' '}
              &ldquo;children exist but are unfetched&rdquo;. Expanding it
              (chevron click, <kbd>→</kbd>, programmatic{' '}
              <code>setExpanded</code>) starts exactly one load:{' '}
              <code>loadChildren(path)</code> resolves to the group&rsquo;s
              canonical child paths (nested descendants allowed; ancestors
              auto-create; invalid paths are skipped). Loaded children then flow
              through the normal projection/window pipeline. The controller
              surface is <code>markUnloaded(paths)</code>,{' '}
              <code>getChildLoadState(path)</code>,{' '}
              <code>requestChildLoad(path)</code>, and{' '}
              <code>cancelChildLoads()</code>, backed by a per-path store state
              machine (unloaded → loading → loaded / error).
            </p>
            <p>
              While a fetch is in flight the group row carries{' '}
              <code>aria-busy=&quot;true&quot;</code> and an expanded group
              shows one fixed-height <em>loading row</em> (CSS-animated dots
              honoring <code>prefers-reduced-motion</code>;{' '}
              <code>aria-hidden</code>, since the group&rsquo;s{' '}
              <code>aria-busy</code> already tells assistive tech). A rejection
              swaps it for an <em>error row</em> with the failure message and a
              real, labelled Retry <code>&lt;button&gt;</code>. Placeholder rows
              are projection-level view rows, not store rows: never selectable,
              never drag sources or drop targets, and keyboard navigation /
              type-ahead skip them — with one deliberate exception to the
              roving-tabindex pattern: the Retry button keeps{' '}
              <code>tabindex=&quot;0&quot;</code>, because the row is not a
              treeitem (<code>aria-activedescendant</code> can never reach it)
              and the only recovery control must stay keyboard-reachable.
              Collapsing and re-expanding an error group does <em>not</em>{' '}
              auto-retry; Retry (or <code>requestChildLoad</code>) is the
              explicit gesture, so a failing endpoint is never hammered by
              browsing.
            </p>
            <ul>
              <li>
                <strong>Expand-all never loads.</strong>{' '}
                <code>expandAll()</code> skips unloaded groups by design: it is
                one gesture, and fanning it out into N network fetches would be
                surprising, slow, and unbounded. Expand the specific group you
                want fetched.
              </li>
              <li>
                <strong>Stale responses are discarded.</strong> Each attempt
                carries a token: a load that settles after{' '}
                <code>cleanUp()</code>, after the group was removed or moved
                (rename / drag &amp; drop), or after a newer attempt for the
                same path is discarded instead of resurrecting rows the tree
                moved on from. The store double-guards this — a completion for a
                machine no longer in <code>loading</code> is refused.
              </li>
              <li>
                <strong>
                  Search &amp; flatten can&rsquo;t see unfetched children.
                </strong>{' '}
                Under <code>hide-non-matches</code> an unloaded group stays
                visible only when the group itself matches, and{' '}
                <code>flattenEmptyGroups</code> never flattens into or through a
                group with a pending load — the placeholder needs an honest
                anchor row.
              </li>
            </ul>

            <h2 id="sticky-ancestors">Sticky ancestor stack</h2>
            <p>
              The sticky header mirrors the top visible row&rsquo;s off-screen
              ancestor(s) above the tree. <code>nearest</code> (default) shows
              the single nearest ancestor; <code>stack</code> shows the whole
              breadcrumb, capped at 4 mirror rows with the nearest ancestors
              winning — unbounded sticky stacks would eat the viewport.
            </p>
            <CodeBlock code={STICKY_STACK_EXAMPLE} />
            <p>
              Mirrors are visually identical to real rows but{' '}
              <code>aria-hidden</code> with no treeitem semantics, and clicking
              one scrolls to and focuses the real ancestor row. Under{' '}
              <code>flattenEmptyGroups</code> and <code>hide-non-matches</code>{' '}
              the stack follows the <em>visible</em>-parent chain, so hidden
              mid-chain groups never surface. The scroller&rsquo;s spacer math
              accounts for the stack height, keeping virtualized rows at exact
              pixel positions.
            </p>

            <h2 id="middle-truncation">Middle name truncation</h2>
            <p>
              Deep charts produce names (and flattened chain labels) longer than
              the row. <code>end</code> (default) keeps plain CSS ellipsis;{' '}
              <code>middle</code> turns on measured middle truncation:
            </p>
            <CodeBlock code={TRUNCATION_EXAMPLE} />
            <p>
              After every window commit — and on container resize — the view
              measures the rendered name elements in one batched pass (all
              reads, then all writes: at most one reflow) and rewrites only the
              overflowing ones as <code>head…tail</code>, keeping the
              leaf&rsquo;s tail visible since account names distinguish at the
              end (<code>Ve…-Maybank</code>, not <code>VeryLongAcc…</code>).
              Truncated rows (and only those) carry <code>title</code> with the
              full name; selection/focus-only patches skip the pass. The full
              name always stays in controller state — inline rename edits the
              real name, never the truncated presentation text.
            </p>

            <h2 id="ime">IME input</h2>
            <p>
              Every keydown surface (navigation, type-ahead, the rename editor)
              ignores events that belong to an active IME composition (
              <code>event.isComposing</code>, or the legacy{' '}
              <code>keyCode === 229</code> older engines report). Enter during
              composition confirms the IME candidate — it never commits a rename
              — and Escape dismisses the candidate without cancelling the rename
              session.
            </p>

            <h2 id="react-api">React API</h2>
            <p>
              The component form covers declarative use; the hook form exposes{' '}
              <code>getInstance()</code> when you need the imperative surface
              (status decorations, scrolling, programmatic selection).
            </p>
            <CodeBlock code={REACT_API} />
            <CodeBlock code={REACT_HOOK} />

            <h2 id="ssr">SSR</h2>
            <p>
              <code>preloadAccountTreeHTML</code> returns shadow-root HTML:
              stylesheet, scroller shell, and a bounded leading row window with
              a correctly sized after-spacer, so scrollbar geometry is right
              before hydration. The client re-windows rows on its first scroll.
            </p>
            <CodeBlock code={SSR_EXAMPLE} />

            <h2 id="theming">Theming</h2>
            <p>
              Identical model to journals — zero class selectors, and every
              color reads a three-step chain from override to theme role to
              built-in <code>light-dark()</code> default:
            </p>
            <CodeBlock code={THEMING_CHAIN} />
            <CodeBlock code={THEMING_OVERRIDE} />
            <p>
              Layout hooks include <code>--accounts-font-family</code>,{' '}
              <code>--accounts-row-height-override</code>,{' '}
              <code>--accounts-density-scale-override</code>, and{' '}
              <code>--accounts-border-radius-override</code>. Balances always
              render with <code>tabular-nums</code>.
            </p>
            <p>
              Every demo on this site renders in{' '}
              <a
                href="https://github.com/paper-design/paper-mono"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-link"
              >
                Paper Mono
              </a>{' '}
              (SIL OFL 1.1) via <code>--accounts-font-family</code>. The package
              bundles no font — download Paper Mono from its repo and set the
              hook to match this look, or point it at your own mono stack.
            </p>

            <h2 id="virtualization">Virtualization</h2>
            <p>
              Each density preset maps to a fixed pixel row height (compact 24 /
              default 30 / relaxed 36), so the visible range is pure arithmetic
              over the scroll position. Give the host element a fixed height to
              turn the internal scroller into a window; a 10,000-account chart
              renders the same handful of rows as a 50-account one.
            </p>
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
