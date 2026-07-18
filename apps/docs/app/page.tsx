import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';
import { JournalEntry } from '@cynco/journals/react';
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';
import { workloads } from '@cynco/ledger-test-data';
import { Asterisk } from 'lucide-react';

import { CyncoCompanySection } from '@/components/CyncoCompanySection';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { AccountTreeDemo } from '@/examples/AccountTreeDemo';
import {
  ACCOUNT_TREE_DEMO_ID,
  PAYROLL_ENTRY,
  UNBALANCED_ENTRY,
} from '@/examples/entries';
import { ReconciliationDemo } from '@/examples/ReconciliationDemo';
import { RegisterDemo } from '@/examples/RegisterDemo';

export default function Home() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <Header className="-mb-[1px]" />
      <Hero />
      <section className="space-y-12 pb-8">
        <JournalEntrySection />
        <RegisterSection />
        <ReconciliationSection />
        <AccountTreeSection />
        <UnbalancedSection />
      </section>
      <CyncoCompanySection />
      <Footer />
    </div>
  );
}

// Each demo is server-prerendered where the packages support it: the SSR
// preload functions return shadow-root HTML that the React components adopt
// during hydration without re-rendering.

async function JournalEntrySection() {
  const ssrHTML = await preloadJournalEntryHTML(PAYROLL_ENTRY, {
    showLineNumbers: true,
  });
  return (
    <section className="space-y-4">
      <FeatureHeader
        id="journal-entries"
        title="Journal entries, rendered properly"
        description={
          <>
            A payroll run with EPF and SOCSO splits across six postings —
            server-rendered into a declarative shadow root and hydrated in
            place. Debits read green, credits read red, and every amount is an
            exact integer in minor units.
          </>
        }
      />
      <div className="demo-container">
        <JournalEntry
          entry={PAYROLL_ENTRY}
          options={{ showLineNumbers: true }}
          ssrHTML={ssrHTML}
        />
      </div>
    </section>
  );
}

function RegisterSection() {
  return (
    <section className="space-y-4">
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
    </section>
  );
}

function ReconciliationSection() {
  return (
    <section className="space-y-4">
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
    <section className="space-y-4">
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
    </section>
  );
}

async function UnbalancedSection() {
  const ssrHTML = await preloadJournalEntryHTML(UNBALANCED_ENTRY);
  return (
    <section className="space-y-4">
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
      <p className="text-muted-foreground flex items-center gap-1 text-sm">
        <Asterisk size={14} className="opacity-50" aria-hidden="true" />
        The cash leg above is exactly RM&nbsp;1.00 short — rendered, flagged,
        never repaired.
      </p>
    </section>
  );
}
