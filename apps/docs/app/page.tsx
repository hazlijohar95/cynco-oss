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
import { LedgerFilmSection } from '@/examples/film/LedgerFilmSection';
import { JournalEntryDemo } from '@/examples/JournalEntryDemo';
import { ReconciliationDemo } from '@/examples/ReconciliationDemo';
import { ReconciliationLegend } from '@/examples/ReconciliationLegend';
import { RegisterComparison } from '@/examples/RegisterComparison';
import { RegisterDemo } from '@/examples/RegisterDemo';
import { WorkspaceDemo } from '@/examples/WorkspaceDemo';
import { cn } from '@/lib/utils';

// The /data section rhythm: every content section is a hairline-topped slab
// with 6rem vertical padding inside a hairline-framed 80rem container.
const SECTION = 'border-border border-t px-6 py-16 md:px-10 md:py-24 lg:px-12';

// Below-the-fold slabs wrap their content in .section-reveal (globals.css),
// a CSS-only scroll-driven fade/rise. The class must sit on this inner
// wrapper rather than the <section> itself: translating the section would
// drag its top hairline out of register with the container's side borders.
// The hero and the workspace centerpiece are exempt — they own the first
// viewport and must paint at full strength immediately.
const REVEAL = 'section-reveal space-y-8';

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
          <LedgerFilmSection />
        </main>
        <Footer className="px-6 md:px-10 lg:px-12" />
      </div>
    </div>
  );
}

// Each demo is server-prerendered where the packages support it: the SSR
// preload functions return shadow-root HTML that the React components adopt
// during hydration without re-rendering.

// The workspace centerpiece completes the hero: with the headline stack
// tightened above, the top padding here is trimmed so the live window's
// chrome, sidebar tree, and first register rows land inside the first
// viewport on a ~900px desktop — the product performing above the fold.
async function WorkspaceSection() {
  const ssrHTML = await preloadAccountTreeHTML({
    id: WORKSPACE_TREE_ID,
    entries: workloads.small(),
    ...WORKSPACE_TREE_OPTIONS,
  });
  return (
    // cn (tailwind-merge) resolves the py overrides against SECTION's
    // defaults; a raw template literal would leave both classes in and let
    // stylesheet order pick the winner.
    <section
      className={cn(SECTION, 'relative py-8 max-md:overflow-x-clip md:py-10')}
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
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="journal-entries"
          title="Journal entries, server-rendered"
          description={
            <>
              A six-posting payroll run, rendered on the server as declarative
              shadow DOM, adopted at hydration. Zero client re-render. Every
              color resolves override → role → default.
            </>
          }
        />
        <JournalEntryDemo ssrHTML={ssrHTML} />
      </div>
    </section>
  );
}

function RegisterSection() {
  return (
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="virtualized-register"
          title="A register that scales"
          description={
            <>
              10,000 entries, one cash account. Fixed row heights make windowing
              pure arithmetic — no measurement, no layout thrash, the same DOM
              node count at 100 rows or 100,000.
            </>
          }
        />
        <RegisterDemo />
        <RegisterComparison />
        <Footnote>
          <code>setFilter</code> reshapes rows in place — group summaries
          recomputed, matches highlighted — while selection and every public
          index stay in full-data space.
        </Footnote>
      </div>
    </section>
  );
}

function ReconciliationSection() {
  return (
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="reconciliation"
          title="Reconciliation as conflict resolution"
          description={
            <>
              Statement lines left, book postings right, matches as tinted
              pairs. Accept or reject from the gutter, like a merge conflict.
              Reconciled means exactly zero — integer arithmetic, no epsilon.
            </>
          }
        />
        <ReconciliationDemo />
        <ReconciliationLegend />
      </div>
    </section>
  );
}

async function EntryDiffSection() {
  const ssrHTML = await preloadEntryDiffHTML(
    FIT_OUT_ENTRY_BEFORE,
    FIT_OUT_ENTRY_AFTER
  );
  return (
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="entry-diff"
          title="Every edit, diffed like code"
          description={
            <>
              Two versions of one entry as an audit-trail diff — word
              highlights, pill adds, postings aligned by account and currency
              with exact before/after amounts. Server-rendered, like every card
              on this page.
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
          Both versions balance to exactly zero. The diff is pure data from{' '}
          <code>diffEntryVersions</code>.
        </Footnote>
      </div>
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
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="chart-of-accounts"
          title="The chart of accounts as a tree"
          description={
            <>
              <code>Assets:Current:Cash-Maybank</code> materializes into a
              keyboard-navigable tree — rolled-up balances, status dots. A file
              tree with git status, for accounts.
            </>
          }
        />
        <AccountTreeDemo ssrHTML={ssrHTML} />
        <AccountTreeComparison />
      </div>
    </section>
  );
}

async function UnbalancedSection() {
  const ssrHTML = await preloadJournalEntryHTML(UNBALANCED_ENTRY);
  return (
    <section className={SECTION}>
      <div className={REVEAL}>
        <FeatureHeader
          id="unbalanced-entries"
          title="Honest about imbalance"
          description={
            <>
              Postings that don&apos;t sum to zero per currency are flagged with
              the exact residual. Never repaired, never hidden.
            </>
          }
        />
        <div className="demo-container">
          <JournalEntry entry={UNBALANCED_ENTRY} ssrHTML={ssrHTML} />
        </div>
        <Footnote>
          The cash leg is exactly RM&nbsp;1.00 short — rendered, flagged, left
          alone.
        </Footnote>
      </div>
    </section>
  );
}
