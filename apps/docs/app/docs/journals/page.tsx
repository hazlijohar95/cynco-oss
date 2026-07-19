import '@/app/prose.css';
import { JournalEntry } from '@cynco/journals/react';
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';
import type { Metadata } from 'next';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import { PAYROLL_ENTRY } from '@/examples/entries';

const docsTitle = 'Journals docs';
const docsDescription =
  'Documentation for @cynco/journals: vanilla and React APIs, SSR ' +
  'hydration, theming, and virtualization for journal entries and account ' +
  'registers.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

const CORE_TYPES = `
/** Integer minor units (sen, cents). Never floats. */
export type MinorUnits = number;

export interface Posting {
  /** Canonical colon-delimited path, e.g. \`Assets:Current:Cash-Maybank\`. */
  account: string;
  /** Signed integer minor units. Positive = debit, negative = credit. */
  amount: MinorUnits;
  /** ISO 4217 or commodity code, e.g. \`MYR\`, \`USD\`. */
  currency: string;
}

export interface LedgerEntry {
  id: string;
  date: string; // ISO \`YYYY-MM-DD\`
  flag: 'cleared' | 'pending' | 'flagged' | 'void';
  payee: string | null;
  narration: string;
  tags: readonly string[];
  links: readonly string[];
  postings: readonly Posting[];
}

export interface RegisterRowData {
  entry: LedgerEntry;
  posting: Posting;
  /** Running balance per currency after this posting, in minor units. */
  runningBalance: ReadonlyMap<string, MinorUnits>;
}
`;

const VANILLA_ENTRY = `
import { JournalEntry } from '@cynco/journals';

const card = new JournalEntry({ showLineNumbers: true });
card.render({
  entry, // a LedgerEntry
  parentNode: document.querySelector('#host')!,
});

// Later: re-render with new data (no-op when the entry is unchanged) …
card.render({ entry: nextEntry });
// … and tear down.
card.cleanUp();
`;

const VANILLA_REGISTER = `
import { Register } from '@cynco/journals';

const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  density: 'comfortable', // or 'compact' (one line per row)
  onRowSelect(row, index) {
    console.log(row.entry.id, index);
  },
});

register.render({
  rows, // readonly RegisterRowData[]
  parentNode: document.querySelector('#host')!,
});

// Swap the data in place; the window re-renders, scroll stays put.
register.setRows(nextRows);
register.setSelectedRow(3);
register.cleanUp();
`;

const VANILLA_LEDGER_VIEW = `
import { LedgerView } from '@cynco/journals';

// Several account registers sharing one scroll container and one
// Virtualizer — sections that are offscreen cost nothing.
const view = new LedgerView({
  density: 'comfortable',
  onRowSelect(account, row, index) {
    console.log(account, row.posting.amount, index);
  },
});

view.render({
  sections: [
    { account: 'Assets:Current:Cash-Maybank', rows: cashRows },
    { account: 'Income:Sales:Services-Consulting', rows: salesRows },
  ],
  parentNode: document.querySelector('#host')!,
});
`;

const KEYBOARD_MAP = `
// Keyboard navigation ships ON: the register grid is a tab stop
// (tabindex="0") and one delegated keydown handler owns the whole map.
// Hosts composing their own focus management can opt out entirely:
const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  disableKeyboardNavigation: true, // no keydown listener, no tabindex
});

// Focus is virtual — aria-activedescendant on the grid points at the
// focused row's id; the row itself is patched with data-focused.
register.focusRow(12); // programmatic counterpart (reveals + focuses)
`;

const RANGE_SELECTION = `
const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  selectionMode: 'range', // 'single' (default) | 'range'
  onSelectionChange({ indexes, rows }) {
    // Sorted entry indexes + their rows, fired on every user-driven
    // change (pointer AND keyboard). Fires in both modes; single mode
    // reports a 0/1-length selection.
    console.log(indexes, rows.length);
  },
});

// RegisterSelection: the shift-range anchor plus the selected entry
// indexes (always entry-index space — group headers are never selectable).
const { anchor, indexes } = register.getSelection();

// Programmatic selection does NOT fire callbacks (original behavior):
register.setSelectedRow(3);
`;

const PERIOD_GROUPING = `
const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  groupBy: 'month', // 'none' (default) | 'month' | 'quarter' | 'year'
  stickyGroupLabels: true, // default whenever groupBy !== 'none'
});

// Each group header renders a RegisterGroupSummary:
// { key: '2026-03', label: 'March 2026', entryCount: 14,
//   netChange: Map { 'MYR' => 152_300 } } — integer minor units, built in
// one O(n) pass per data update.
`;

const SCROLL_APIS = `
// Every scroll-to API takes the same options:
// { align?: 'start' | 'center' | 'nearest'; behavior?: 'smooth' | 'auto' }
register.scrollToRow(500, { align: 'center', behavior: 'smooth' });
register.scrollToDate('2026-03-01'); // first row dated on/after (binary search)
ledgerView.scrollToSection('Assets:Current:AR', { behavior: 'smooth' });
ledgerView.scrollToRow('Assets:Current:AR', 12, { align: 'start' });

// Spring tuning (Register and LedgerView options, or SmoothScroller
// directly for your own containers):
const settings: SmoothScrollSettings = {
  omega: 0.015,         // rad/ms; 99% settle ≈ 6.6 / omega (~440ms here)
  epsilonPx: 0.5,       // remaining distance below which it may settle
  epsilonVelocity: 0.01, // velocity below which it may settle
};
new Register({ account, smoothScrollSettings: settings });
`;

const ENTRY_DIFF_API = `
import { diffEntryVersions, EntryDiff } from '@cynco/journals';

// Pure data: the ledger analog of a file diff. Header fields get
// word-level segments, tags/links diff as sets, postings align by
// (account, currency) — amounts stay integer minor units end to end.
const diff = diffEntryVersions(before, after);
// diff.kind: 'created' | 'deleted' | 'modified' | 'unchanged'
// diff.postings: [{ kind: 'amount-changed', account, currency,
//                   beforeAmount, afterAmount }, ...]

// The component follows the JournalEntry lifecycle exactly:
const card = new EntryDiff();
card.render({
  before, // null models entry creation (everything added)
  after,  // null models deletion/void (everything removed)
  parentNode: document.querySelector('#host')!,
});
card.cleanUp();
`;

const ENTRY_DIFF_SSR = `
// Server component
import { EntryDiff } from '@cynco/journals/react';
import { preloadEntryDiffHTML } from '@cynco/journals/ssr';

export default async function AuditTrail() {
  const ssrHTML = await preloadEntryDiffHTML(before, after);
  return <EntryDiff before={before} after={after} ssrHTML={ssrHTML} />;
}
`;

const LEDGER_VIEW_V2 = `
// Incremental reconciliation, keyed by account path: unchanged sections
// keep their Register instance and DOM, data-changed sections update in
// place (structural row equality, so fresh-but-identical arrays from
// immutable stores are "unchanged"), added sections mount, removed
// sections clean up, and order changes reorder DOM nodes without
// recreating anything.
view.setSections([
  { account: 'Assets:Current:Cash-Maybank', rows: cashRows },
  { account: 'Assets:Current:AR', rows: arRows },
]);
`;

const LEDGER_VIEW_SSR = `
import { preloadLedgerViewHTML } from '@cynco/journals/ssr';

const ssrHTML = await preloadLedgerViewHTML(sections, { id: 'ledger' });

// Client: pass the SAME id so ARIA row ids agree.
const view = new LedgerView({ id: 'ledger' });
view.hydrate({ sections, container }); // falls back to render when
                                       // the markup is missing
`;

const RECONCILIATION_API = `
import { proposeMatches, Reconciliation } from '@cynco/journals';

// Deterministic proposals, three passes: exact (amount + currency + date),
// nearest-date within ±dateWindowDays, then sum matching — one statement
// line covered by 2..maxGroupSize postings in the same currency and window
// (kind 'sum', rendered as a stacked group with a Σ total row).
const matches = proposeMatches(statementLines, postings, {
  dateWindowDays: 3, // default
  maxGroupSize: 3, // default; pass 1 to disable sum matching
});

const reconciliation = new Reconciliation({
  account: 'Assets:Current:Cash-Maybank',
  periodLabel: 'Jul 2026',
  statementLines, // StatementLine[] — parsed bank lines, integer minor units
  postings, // BookPostingRef[] — { entry, postingIndex }
  matches, // optional; this is the default
  onAccept(match) {
    console.log('cleared', match.id);
  },
  onCreateEntry(line) {
    // The component never writes entries — that is your data layer's job.
    openEntryForm(line);
  },
});
reconciliation.render({ parentNode: document.querySelector('#host')! });

// Imperative controls mirror the gutter buttons. Match ids are
// deterministic: m-<lineId>-<entryId>-<postingIndex>, '+'-joined for sums.
reconciliation.acceptMatch('m-l1-e1-0');
const { matches: current, difference } = reconciliation.getState();
// Each match carries postings: readonly BookPostingRef[] (one entry for
// exact/suggested, 2..maxGroupSize for sums).
// difference: Map<currency, MinorUnits> — statement − accepted, exact.
`;

const ENTRY_STREAM_API = `
import { createEntryStreamFromArray, EntryStream } from '@cynco/journals';

const stream = new EntryStream({
  // ReadableStream<LedgerEntry> or any AsyncIterable<LedgerEntry>;
  // consumed exactly once.
  stream: entrySource,
  total: 500, // optional: footer shows "n / 500"
  autoScroll: true, // stick to bottom until the user scrolls up
  onEntry(entry, index) {},
  onDone(count) {},
});
stream.render({ parentNode: document.querySelector('#host')! });

// Entries arriving within one frame commit as ONE DOM write; the sticky
// footer tracks the running count. cleanUp() cancels the reader.
stream.cleanUp();

// Demo/test helper: array -> stream on a fixed cadence.
const entrySource = createEntryStreamFromArray(entries, { delayMs: 40 });
`;

const WORKER_API = `
import {
  getOrCreateWorkerPoolSingleton,
} from '@cynco/journals/worker';
// Vite: the fully-bundled portable worker entry.
import JournalsWorker from '@cynco/journals/worker/worker-portable.js?worker';

const pool = getOrCreateWorkerPoolSingleton({
  workerFactory: () => new JournalsWorker(),
  // poolSize: min(2, hardwareConcurrency); resultCacheSize: 200 (LRU)
});

// Components accept the pool as an option; without one (or after any
// worker failure) they use the synchronous path — same renderer, same
// output, so workers are purely a performance upgrade.
new Register({ account, workerPool: pool });
new Reconciliation({ account, statementLines, postings, workerPool: pool });

// Direct API, resolved off-thread with dedupe + LRU caching:
const html = await pool.renderRegisterWindow({ rows, range, selectedIndex });
const matches = await pool.proposeMatches({ statementLines, postings });
pool.subscribeToStatChanges((stats) => console.log(stats.busyWorkers));
`;

const REACT_API = `
import {
  JournalEntry,
  LedgerView,
  Register,
} from '@cynco/journals/react';

export function CashRegister({ rows }: { rows: RegisterRowData[] }) {
  return (
    <Register
      rows={rows}
      options={{
        account: 'Assets:Current:Cash-Maybank',
        density: 'compact',
        onRowSelect: (row, index) => select(row, index),
      }}
      style={{ height: 480 }}
    />
  );
}
`;

const SSR_SERVER = `
// app/page.tsx — a React Server Component
import { JournalEntry } from '@cynco/journals/react';
import {
  preloadJournalEntryHTML,
  preloadRegisterHTML,
} from '@cynco/journals/ssr';

export default async function Page() {
  const ssrHTML = await preloadJournalEntryHTML(entry, {
    showLineNumbers: true,
  });
  return (
    <JournalEntry
      entry={entry}
      options={{ showLineNumbers: true }}
      ssrHTML={ssrHTML}
    />
  );
}
`;

const THEMING_CHAIN = `
/* Every color resolves override → theme → built-in default: */
--journals-debit: var(
  --journals-debit-override,
  var(--journals-theme-ledger-debit, light-dark(#199f43, #5ecc71))
);
`;

const THEMING_OVERRIDE = `
/* One-off overrides: set the override hook on any ancestor. */
journals-container {
  --journals-font-family: var(--font-mono);
  --journals-accent-override: #009fff;
  --journals-debit-override: oklch(0.72 0.19 150);
}
`;

const THEMING_ROLES = `
import { journalsThemeVariables } from '@cynco/journals';
import { dark } from '@cynco/theme';

// Whole-palette theming: map @cynco/theme roles onto the
// --journals-theme-* layer (sits between overrides and defaults).
const variables = journalsThemeVariables(dark);
for (const [name, value] of Object.entries(variables)) {
  host.style.setProperty(name, value);
}
`;

const VIRTUALIZATION = `
const register = new Register({
  account: 'Assets:Current:Cash-Maybank',
  // Pixel height of one text line. Must match the effective
  // --journals-line-height (default 20px) or spacer heights drift.
  lineHeight: 20,
  // Sticky header height; must match the header CSS (default 44px).
  headerHeight: 44,
  // Extra rows rendered above and below the pixel window. Default 10.
  overscanRows: 10,
});
`;

export default async function JournalsDocsPage() {
  const heroEntryHTML = await preloadJournalEntryHTML(PAYROLL_ENTRY, {
    showLineNumbers: true,
  });

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <h1>Journals</h1>
            <p>
              <code>@cynco/journals</code> renders journal entries and account
              registers. The core is framework-free TypeScript drawing into a{' '}
              <code>&lt;journals-container&gt;</code> custom element with an
              open shadow root; React wrappers only manage lifecycle. Amounts
              are integer minor units end to end — no floats ever touch money.
            </p>
            <div className="demo-container">
              <JournalEntry
                entry={PAYROLL_ENTRY}
                options={{ showLineNumbers: true }}
                ssrHTML={heroEntryHTML}
              />
            </div>

            <h2 id="installation">Installation</h2>
            <p>
              Install with the package manager of your choice. React and
              react-dom are optional peer dependencies — the vanilla API works
              without them.
            </p>
            <CodeBlock code="pnpm add @cynco/journals" />
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
                    <code>@cynco/journals</code>
                  </td>
                  <td>
                    Vanilla classes (<code>JournalEntry</code>,{' '}
                    <code>Register</code>, <code>LedgerView</code>,{' '}
                    <code>EntryDiff</code>), pure HTML renderers, and utilities
                    like <code>formatMinorUnits</code> and{' '}
                    <code>diffEntryVersions</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/journals/react</code>
                  </td>
                  <td>
                    Thin React components wrapping the vanilla classes, plus the
                    hydration glue
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/journals/ssr</code>
                  </td>
                  <td>
                    <code>preloadJournalEntryHTML</code>,{' '}
                    <code>preloadRegisterHTML</code>,{' '}
                    <code>preloadLedgerViewHTML</code>,{' '}
                    <code>preloadReconciliationHTML</code>, and{' '}
                    <code>preloadEntryDiffHTML</code> for server prerendering
                  </td>
                </tr>
              </tbody>
            </table>

            <h2 id="core-types">Core types</h2>
            <p>
              The whole suite agrees on three shapes. Balanced entries sum to
              exactly zero per currency; the renderer displays unbalanced input
              but flags it — the data layer never silently repairs it.
            </p>
            <CodeBlock code={CORE_TYPES} />

            <h2 id="vanilla-api">Vanilla API</h2>
            <p>
              Each component is a plain class: construct with options, call{' '}
              <code>render</code> with data and a mount target, call{' '}
              <code>cleanUp</code> when done. Rendering commits whole windows of
              pure HTML strings with single <code>innerHTML</code> writes.
            </p>
            <h3>JournalEntry</h3>
            <CodeBlock code={VANILLA_ENTRY} />
            <h3>Register</h3>
            <p>
              A virtualized single-account register (bank-statement style) with
              a sticky balance header. Give the host element a fixed height to
              turn the internal scroller into a window.
            </p>
            <CodeBlock code={VANILLA_REGISTER} />
            <h3>LedgerView</h3>
            <CodeBlock code={VANILLA_LEDGER_VIEW} />

            <h2 id="keyboard-navigation">Keyboard navigation &amp; ARIA</h2>
            <p>
              The register is an ARIA grid: <code>role=&quot;grid&quot;</code>{' '}
              with <code>aria-label</code> (the <code>label</code> option,
              defaulting to the account path), <code>aria-rowcount</code>{' '}
              counting model rows (interleaved group headers included), rows
              with <code>role=&quot;row&quot;</code> +{' '}
              <code>aria-rowindex</code> + <code>aria-selected</code>, cells
              with <code>role=&quot;gridcell&quot;</code>, and — in range mode —{' '}
              <code>aria-multiselectable</code>. Group header rows are real grid
              rows spanning every column via <code>aria-colspan</code>, but stay
              non-interactive. Focus is virtual: the grid is the single tab stop
              and <code>aria-activedescendant</code> points at the focused row,
              so navigation lives in entry-index space and group headers are
              skipped without any bookkeeping.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <kbd>↓</kbd> / <kbd>↑</kbd>
                  </td>
                  <td>
                    Move focus one entry row. At a section edge inside a{' '}
                    <code>LedgerView</code>, focus hands off to the neighboring
                    section (the <code>onFocusBoundary</code> hook); standalone
                    registers clamp.
                  </td>
                </tr>
                <tr>
                  <td>
                    <kbd>Home</kbd> / <kbd>End</kbd>
                  </td>
                  <td>First / last entry row.</td>
                </tr>
                <tr>
                  <td>
                    <kbd>PageDown</kbd> / <kbd>PageUp</kbd>
                  </td>
                  <td>One viewport&rsquo;s worth of entry rows.</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Enter</kbd> / <kbd>Space</kbd>
                  </td>
                  <td>
                    Select the focused row — exactly a plain click, one shared
                    code path, so pointer and keyboard can never drift apart.
                  </td>
                </tr>
                <tr>
                  <td>
                    <kbd>Shift</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd>
                  </td>
                  <td>
                    Range mode: extend the selection from the anchor (a
                    shift-click on the new row).
                  </td>
                </tr>
                <tr>
                  <td>
                    <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>A</kbd>
                  </td>
                  <td>
                    Range mode: select every entry row. Single mode leaves the
                    browser&rsquo;s select-all alone.
                  </td>
                </tr>
                <tr>
                  <td>
                    <kbd>Escape</kbd>
                  </td>
                  <td>Clear the selection (no-op when nothing is selected).</td>
                </tr>
              </tbody>
            </table>
            <p>
              Keys consumed by an active IME composition (Enter confirming a
              candidate, Escape dismissing one) never drive navigation or
              selection. Keyboard navigation ships on by default — the
              breaking-ish part of this feature: the register becomes a tab stop
              on every page that embeds it. That is the right default (a
              pointer-only data grid is inaccessible), but hosts composing their
              own focus management get an escape hatch:
            </p>
            <CodeBlock code={KEYBOARD_MAP} />

            <h2 id="range-selection">Range selection</h2>
            <p>
              <code>selectionMode: &apos;single&apos;</code> (default) preserves
              the original one-row behavior exactly.{' '}
              <code>&apos;range&apos;</code> is Pierre-style line selection:
              click selects one row and sets the anchor, shift-click extends
              anchor→target contiguously, meta/ctrl-click toggles a row in or
              out. Keyboard mirrors pointer exactly. <code>onRowSelect</code>{' '}
              keeps firing for the primary (last-clicked) row for back-compat.
            </p>
            <CodeBlock code={RANGE_SELECTION} />

            <h2 id="period-grouping">Period grouping</h2>
            <p>
              <code>groupBy</code> interleaves period header rows — month,
              quarter, or year — into the virtual row space; <code>none</code>{' '}
              keeps the flat pure-arithmetic fast path. Each header shows the
              period label, distinct-entry count, and net change per currency.
              Selection, <code>data-row-index</code>, and every callback stay in
              entry-index space regardless of grouping.
            </p>
            <CodeBlock code={PERIOD_GROUPING} />
            <p>
              With grouping active, the current period&rsquo;s label pins as a
              slim strip just below the register&rsquo;s sticky header (
              <code>stickyGroupLabels</code> defaults to true). It is a mirror
              of the real group row — aria-hidden and pointer-inert, because{' '}
              <code>position: sticky</code> cannot work on rows a virtualized
              window evicts and recreates — updated from the prefix-sum row
              model in O(log n) per scroll frame, with DOM writes only when the
              period changes. In a <code>LedgerView</code> it pins below the
              owning section&rsquo;s sticky header.
            </p>

            <h2 id="scroll-apis">Scroll APIs</h2>
            <p>
              <code>scrollToRow</code>, <code>scrollToDate</code> (first row
              dated on or after, by binary search), and the LedgerView
              counterparts share one options shape. <code>align</code> defaults
              to <code>nearest</code> for rows (minimal movement; a no-op when
              the row is already visible) and <code>start</code> for sections,
              which accounts for the sticky header overlaying the viewport top.{' '}
              <code>behavior</code> defaults to <code>auto</code> (instant) —
              smooth is opt-in everywhere. Targets come from the same
              data-derived offsets the virtualizer uses, so no layout reads
              happen before a scroll; out-of-range rows, unknown accounts, and
              dates past the last row are graceful no-ops.
            </p>
            <CodeBlock code={SCROLL_APIS} />
            <p>
              Smooth scrolling is a critically-damped spring — it approaches the
              target as fast as possible without ever overshooting, because
              scroll positions must never bounce past a row and come back. User
              input wins: wheel, touch, scrollbar drags, and scroll keys cancel
              an in-flight animation instantly (listeners exist only while
              animating), and <code>prefers-reduced-motion</code> turns every
              smooth scroll into an instant jump. Keyboard focus reveal stays
              instant so it never lags typing.
            </p>

            <h2 id="reconciliation">Reconciliation</h2>
            <p>
              The accounting analog of a merge-conflict resolver: statement
              lines on the left, book postings on the right, proposed matches as
              tinted pairs with accept / reject in a center gutter.{' '}
              <code>proposeMatches</code> is deterministic and runs three passes
              — an <em>exact</em> match shares amount, currency, and date; a{' '}
              <em>suggested</em> match shares amount and currency within{' '}
              <code>dateWindowDays</code>; a <em>sum</em> match covers one
              statement line with 2..<code>maxGroupSize</code> postings (bounded
              search, capped at 10,000 combinations per line, so adversarial
              inputs stay cheap). Sum pairs render the group stacked in one book
              cell with a <code>Σ</code> total row. Unmatched lines keep a{' '}
              <em>create entry</em> affordance and unmatched postings read as{' '}
              <em>outstanding</em>. The header difference (statement total −
              accepted book total) is integer minor-unit math and flips to jade
              only at exactly zero.
            </p>
            <CodeBlock code={RECONCILIATION_API} />
            <ul>
              <li>
                <code>acceptMatch / rejectMatch / undoMatch(id)</code> — the
                same transitions the gutter buttons drive; each fires its
                callback with the transitioned match.
              </li>
              <li>
                <code>getState()</code> — current matches plus the per-currency
                difference map.
              </li>
              <li>
                <code>&lt;Reconciliation options ssrHTML /&gt;</code> from{' '}
                <code>@cynco/journals/react</code> and{' '}
                <code>preloadReconciliationHTML</code> from{' '}
                <code>@cynco/journals/ssr</code> follow the same hydration
                contract as the other components.
              </li>
            </ul>

            <h2 id="entry-diff">EntryDiff</h2>
            <p>
              The audit-trail view: the diff between two versions of a journal
              entry, rendered like a file diff. <code>diffEntryVersions</code>{' '}
              is pure data — scalar header fields (date, flag, payee, narration)
              classify as unchanged / changed / added / removed with word-level
              segments for changed text (adjacent changed runs separated by a
              single space merge, so highlights read as phrases, not confetti);
              tags and links diff as sets; postings pair by (account, currency),
              so both sides of an amount change share account and currency.{' '}
              <code>null</code> on either side models creation or deletion.
            </p>
            <CodeBlock code={ENTRY_DIFF_API} />
            <CodeBlock code={ENTRY_DIFF_SSR} />
            <p>
              Client renders and SSR preloads share the same string builder, so
              hydration adopts the server DOM verbatim with zero writes. The
              diff card is a read-only audit artifact: posting annotation slots
              are deliberately not supported.
            </p>

            <h2 id="ledger-view-v2">LedgerView v2</h2>
            <p>
              <code>setSections</code> reconciles incrementally instead of
              rebuilding, and focus and selection are per-register state keyed
              by entry index, so they survive whenever their section survives:
            </p>
            <CodeBlock code={LEDGER_VIEW_V2} />
            <p>
              Across <code>setSections</code> the scroll position anchors to
              what the user sees: the topmost visible section + entry row is
              captured before the update and restored after, so sections
              growing, shrinking, appearing, or disappearing above it never
              shift the content in view. If the anchor section itself was
              removed, the nearest surviving neighbor takes its place (preceding
              first, then following), falling back to the raw scrollTop only
              when nothing survives.
            </p>
            <CodeBlock code={LEDGER_VIEW_SSR} />
            <p>
              The preload emits the shared scroller, every section&rsquo;s
              sticky header, and each section&rsquo;s leading rows — capped per
              section (128) and across the view (512 total, leading sections
              first) — with exactly sized spacers, so pre-hydration scrollbar
              geometry matches what the hydrated client computes.{' '}
              <code>&lt;LedgerView sections options ssrHTML /&gt;</code> from{' '}
              <code>@cynco/journals/react</code> takes the preload just like{' '}
              <code>Register</code>.
            </p>

            <h2 id="entry-stream">EntryStream</h2>
            <p>
              Renders journal entries live from a{' '}
              <code>ReadableStream&lt;LedgerEntry&gt;</code> (or any async
              iterable). Arrivals are buffered through the shared
              animation-frame queue: however many entries land within one frame,
              the DOM sees exactly one append — never more than one layout per
              frame. A sticky footer strip tracks the running count, and
              stick-to-bottom autoscroll releases the moment the user scrolls up
              (and re-engages when they return to the bottom). Also available as{' '}
              <code>&lt;EntryStream options /&gt;</code> from{' '}
              <code>@cynco/journals/react</code>.
            </p>
            <CodeBlock code={ENTRY_STREAM_API} />

            <h2 id="worker-pool">Worker pool</h2>
            <p>
              <code>@cynco/journals/worker</code> moves the heavy pure
              computations — register window HTML and reconciliation proposals —
              off the main thread. The renderers are DOM-free string builders,
              so the worker runs the exact same code the sync path runs; results
              are deduped by key, LRU-cached, and committed on the next
              animation frame with spacer geometry already in place, so scroll
              position never jumps. If workers cannot start (or die mid-job) the
              pool transparently computes on the main thread instead — a failed
              pool is a performance regression, never a correctness one.
            </p>
            <CodeBlock code={WORKER_API} />
            <ul>
              <li>
                <code>@cynco/journals/worker/worker.js</code> — plain module
                worker entry for bundlers that can follow package imports inside
                workers.
              </li>
              <li>
                <code>@cynco/journals/worker/worker-portable.js</code> —
                fully-bundled variant (no imports) for bundler worker plugins
                like Vite&apos;s <code>?worker</code>.
              </li>
              <li>
                React: <code>WorkerPoolProvider</code> /{' '}
                <code>useWorkerPool()</code> from{' '}
                <code>@cynco/journals/react</code> thread one pool through a
                subtree; components work without it.
              </li>
            </ul>

            <h2 id="react-api">React API</h2>
            <p>
              The React components are deliberately thin: a ref callback owns
              exactly one vanilla instance, and a layout effect pushes prop
              changes into it after every committed render. All rendering logic
              stays in the vanilla classes.
            </p>
            <CodeBlock code={REACT_API} />
            <ul>
              <li>
                <code>&lt;JournalEntry entry options ssrHTML /&gt;</code> — one
                entry card.
              </li>
              <li>
                <code>&lt;Register rows options ssrHTML /&gt;</code> — one
                virtualized account register.
              </li>
              <li>
                <code>&lt;LedgerView sections options ssrHTML /&gt;</code> —
                several registers in one scroll container.
              </li>
              <li>
                <code>&lt;EntryDiff before after options ssrHTML /&gt;</code> —
                the audit-trail diff card.
              </li>
            </ul>

            <h2 id="ssr">SSR</h2>
            <p>
              The preload functions run in Node (server components, route
              handlers) and return shadow-root HTML — component stylesheet
              inlined, markup produced by the same string builders the client
              uses. Pass the result to the matching React component&apos;s{' '}
              <code>ssrHTML</code> prop: the server emits a declarative shadow
              DOM template, the browser attaches a styled shadow root before any
              JS runs, and hydration adopts the parsed DOM without re-rendering.
            </p>
            <CodeBlock code={SSR_SERVER} />
            <p>
              <code>preloadRegisterHTML(rows, options)</code> renders every row
              (the server cannot know the viewport), so prefer it for bounded
              registers and let large ones render client-side.
            </p>

            <h2 id="theming">Theming</h2>
            <p>
              The stylesheet uses zero class selectors — data attributes only —
              and every color resolves through a three-step custom property
              chain, so one DOM serves both modes:
            </p>
            <CodeBlock code={THEMING_CHAIN} />
            <CodeBlock code={THEMING_OVERRIDE} />
            <CodeBlock code={THEMING_ROLES} />
            <p>
              Layout hooks follow the same pattern:{' '}
              <code>--journals-font-family</code>,{' '}
              <code>--journals-font-size</code> (default 13px), and{' '}
              <code>--journals-line-height</code> (default 20px). Amounts always
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
              (SIL OFL 1.1) via <code>--journals-font-family</code>. The package
              bundles no font — download Paper Mono from its repo and set the
              hook to match this look, or point it at your own mono stack.
            </p>

            <h2 id="virtualization">Virtualization</h2>
            <p>
              Fixed row heights make the window math pure arithmetic: the
              rendered range and spacer heights derive from the scroll position
              with no per-row measurement, so 100k-row registers render the same
              handful of nodes as 100-row ones.
            </p>
            <CodeBlock code={VIRTUALIZATION} />
            <p>
              Standalone registers own their <code>Virtualizer</code>;{' '}
              <code>LedgerView</code> shares one across sections and supplies
              per-section offsets, so offscreen sections keep only their two
              spacers in the DOM.
            </p>
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
