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
// Rows are HTML5 drag sources; group rows are drop targets. Guards mirror
// Pierre's trees: no self-drops, no drops into an own descendant, drops on
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
                    utilities
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
