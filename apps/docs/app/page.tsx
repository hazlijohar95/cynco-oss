import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';
import { EntryDiff, JournalEntry } from '@cynco/journals/react';
import {
  preloadEntryDiffHTML,
  preloadJournalEntryHTML,
} from '@cynco/journals/ssr';
import { workloads } from '@cynco/ledger-test-data';

import { CyncoCompanySection } from '@/components/CyncoCompanySection';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Footer } from '@/components/Footer';
import { Footnote } from '@/components/Footnote';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { AccountTreeComparison } from '@/examples/AccountTreeComparison';
import { AccountTreeDemo } from '@/examples/AccountTreeDemo';
import {
  ACCOUNT_TREE_DEMO_ID,
  FIT_OUT_ENTRY_AFTER,
  FIT_OUT_ENTRY_BEFORE,
  PAYROLL_ENTRY,
  UNBALANCED_ENTRY,
  WORKSPACE_TREE_ID,
  WORKSPACE_TREE_OPTIONS,
} from '@/examples/entries';
import { JournalEntryDemo } from '@/examples/JournalEntryDemo';
import { ReconciliationDemo } from '@/examples/ReconciliationDemo';
import { ReconciliationLegend } from '@/examples/ReconciliationLegend';
import { RegisterComparison } from '@/examples/RegisterComparison';
import { RegisterDemo } from '@/examples/RegisterDemo';
import { WorkspaceDemo } from '@/examples/WorkspaceDemo';

// The /data section rhythm: every content section is a hairline-topped slab
// with 6rem vertical padding inside a hairline-framed 80rem container.
const SECTION = 'border-border border-t px-6 py-16 md:px-10 md:py-24 lg:px-12';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col font-mono">
      <div className="border-border mx-auto w-full max-w-[80rem] flex-1 min-[81rem]:border-x">
        <Header className="mx-0 px-6 md:px-10 lg:px-12" />
        <main id="main">
          <Hero />
          <WorkspaceSection />
          <JournalEntrySection />
          <RegisterSection />
          <ReconciliationSection />
          <EntryDiffSection />
          <AccountTreeSection />
          <UnbalancedSection />
          <CyncoCompanySection />
        </main>
        <Footer />
      </div>
    </div>
  );
}

// Each demo is server-prerendered where the packages support it: the SSR
// preload functions return shadow-root HTML that the React components adopt
// during hydration without re-rendering.

// The workspace centerpiece sits directly under the hero, mirroring the
// reference placement (the first chart section right after the hero).
async function WorkspaceSection() {
  const ssrHTML = await preloadAccountTreeHTML({
    id: WORKSPACE_TREE_ID,
    entries: workloads.small(),
    ...WORKSPACE_TREE_OPTIONS,
  });
  return (
    <section
      className={`${SECTION} relative py-12 max-md:overflow-x-clip md:py-16`}
    >
      <WorkspaceDemo ssrHTML={ssrHTML} />
    </section>
  );
}

async function JournalEntrySection() {
  const ssrHTML = await preloadJournalEntryHTML(PAYROLL_ENTRY, {
    showLineNumbers: true,
  });
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="journal-entries"
        title="Journal entries, server-rendered"
        description={
          <>
            A six-posting payroll run — EPF and SOCSO splits — rendered on the
            server as declarative shadow DOM and adopted at hydration, with no
            client re-render. Every color resolves through the{' '}
            <code>@cynco/theme</code> chain: override → role → default, per
            color scheme.
          </>
        }
      />
      <JournalEntryDemo ssrHTML={ssrHTML} />
    </section>
  );
}

function RegisterSection() {
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="virtualized-register"
        title="A register that scales"
        description={
          <>
            10,000 seeded entries against one cash account. Fixed row heights
            reduce windowing to arithmetic — no measurement, no layout thrash —
            so the register mounts the same number of DOM nodes at 100 rows or
            100,000.
          </>
        }
      />
      <RegisterDemo />
      <RegisterComparison />
      <Footnote>
        Registers also take a projection-level filter: <code>setFilter</code>{' '}
        reshapes the visible rows in place — group summaries recomputed over the
        matched rows, matched substrings highlighted — while selection and every
        public index stay in full-data space.
      </Footnote>
    </section>
  );
}

function ReconciliationSection() {
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="reconciliation"
        title="Reconciliation as conflict resolution"
        description={
          <>
            Statement lines left, book postings right, proposed matches as
            tinted pairs. Accept ✓ or reject ✗ from the center gutter, like
            resolving a merge conflict. The difference is integer arithmetic and
            reads reconciled only at exactly zero.
          </>
        }
      />
      <ReconciliationDemo />
      <ReconciliationLegend />
    </section>
  );
}

async function EntryDiffSection() {
  const ssrHTML = await preloadEntryDiffHTML(
    FIT_OUT_ENTRY_BEFORE,
    FIT_OUT_ENTRY_AFTER
  );
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="entry-diff"
        title="Every edit, diffed like code"
        description={
          <>
            Two versions of one entry rendered as an audit-trail diff — word
            highlights on the narration, tag and link pills added, postings
            aligned by account and currency with exact before/after amounts.
            Server-rendered via <code>preloadEntryDiffHTML</code> and adopted at
            hydration, like every card on this page.
          </>
        }
      />
      <div className="demo-container">
        <EntryDiff
          before={FIT_OUT_ENTRY_BEFORE}
          after={FIT_OUT_ENTRY_AFTER}
          ssrHTML={ssrHTML}
        />
      </div>
      <Footnote>
        The revised quote splits out a delivery leg — both versions balance to
        exactly zero, and the diff is pure data from{' '}
        <code>diffEntryVersions</code>.
      </Footnote>
    </section>
  );
}

async function AccountTreeSection() {
  const ssrHTML = await preloadAccountTreeHTML({
    id: ACCOUNT_TREE_DEMO_ID,
    entries: workloads.small(),
    currency: 'MYR',
    initialExpansion: 'top-level',
  });
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="chart-of-accounts"
        title="The chart of accounts as a tree"
        description={
          <>
            Canonical colon-delimited paths —{' '}
            <code>Assets:Current:Cash-Maybank</code> — materialize into a
            keyboard-navigable tree with rolled-up balances and status dots. A
            file tree with git status, for accounts.
          </>
        }
      />
      <AccountTreeDemo ssrHTML={ssrHTML} />
      <AccountTreeComparison />
    </section>
  );
}

async function UnbalancedSection() {
  const ssrHTML = await preloadJournalEntryHTML(UNBALANCED_ENTRY);
  return (
    <section className={`${SECTION} space-y-8`}>
      <FeatureHeader
        id="unbalanced-entries"
        title="Honest about imbalance"
        description={
          <>
            The store never repairs a broken entry. When postings don&apos;t sum
            to zero per currency, the renderer flags the entry and reports the
            exact residual.
          </>
        }
      />
      <div className="demo-container">
        <JournalEntry entry={UNBALANCED_ENTRY} ssrHTML={ssrHTML} />
      </div>
      <Footnote>
        The cash leg above is exactly RM&nbsp;1.00 short — rendered, flagged,
        never repaired.
      </Footnote>
    </section>
  );
}
