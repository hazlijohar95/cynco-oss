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

const RECONCILIATION_API = `
import { proposeMatches, Reconciliation } from '@cynco/journals';

// Deterministic proposals: exact (amount + currency + date) first, then
// nearest-date within ±3 days. Strictly 1:1 — sums stay unmatched.
const matches = proposeMatches(statementLines, postings, {
  dateWindowDays: 3,
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

// Imperative controls mirror the gutter buttons.
reconciliation.acceptMatch('m-l1-e1-0');
const { matches: current, difference } = reconciliation.getState();
// difference: Map<currency, MinorUnits> — statement − accepted, exact.
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
  --journals-font-family: var(--font-geist-mono);
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
                    <code>Register</code>, <code>LedgerView</code>), pure HTML
                    renderers, and utilities like <code>formatMinorUnits</code>
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
                    <code>preloadJournalEntryHTML</code> and{' '}
                    <code>preloadRegisterHTML</code> for server prerendering
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

            <h2 id="reconciliation">Reconciliation</h2>
            <p>
              The accounting analog of a merge-conflict resolver: statement
              lines on the left, book postings on the right, proposed matches as
              tinted pairs with accept / reject in a center gutter.{' '}
              <code>proposeMatches</code> is deterministic and strictly 1:1 on
              identical amounts — an <em>exact</em> match shares amount,
              currency, and date; a <em>suggested</em> match shares amount and
              currency within <code>dateWindowDays</code>. It never proposes sum
              matches; unmatched lines keep a <em>create entry</em> affordance
              and unmatched postings read as <em>outstanding</em>. The header
              difference (statement total − accepted book total) is integer
              minor-unit math and flips to jade only at exactly zero.
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
                <code>&lt;LedgerView sections options /&gt;</code> — several
                registers in one scroll container.
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
