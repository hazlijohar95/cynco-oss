import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';
import { JournalEntry } from '@cynco/journals/react';
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';
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
        <Hero />
        <WorkspaceSection />
        <JournalEntrySection />
        <RegisterSection />
        <ReconciliationSection />
        <AccountTreeSection />
        <UnbalancedSection />
        <CyncoCompanySection />
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
        title="Journal entries, rendered properly"
        description={
          <>
            A payroll run with EPF and SOCSO splits across six postings —
            server-rendered into a declarative shadow root and hydrated in
            place. Pick the role palettes for each mode, pin the scheme, or
            toggle the posting-number gutter: every color resolves through the{' '}
            <code>@cynco/theme</code> chain.
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
            Ten thousand generated entries, one cash account, a handful of DOM
            nodes. Fixed row heights make the window math pure arithmetic, so a
            100k-row register renders the same number of nodes as a 100-row one.
          </>
        }
      />
      <RegisterDemo />
      <RegisterComparison />
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
            tinted pairs — accept ✓ or reject ✗ from the center gutter, exactly
            like resolving a merge conflict. The difference figure is integer
            math and turns jade only at exactly zero.
          </>
        }
      />
      <ReconciliationDemo />
      <ReconciliationLegend />
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
            <code>@cynco/accounts</code> materializes account paths into a
            keyboard-navigable tree with rolled-up balances and status dots —
            the accounting analog of a file tree with git status.
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
            The data layer never silently repairs a broken entry. When postings
            don&apos;t sum to zero, the renderer flags it with the dashed
            checker bar and reports the exact per-currency residual.
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
