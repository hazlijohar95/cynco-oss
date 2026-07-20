import type { Metadata } from 'next';

import { LedgerDevClient } from './LedgerDevClient';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { GITHUB_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Performance lab',
  description:
    'Generate seeded ledger workloads up to 1,000,000 entries in your ' +
    'browser and watch the virtualized register and account tree handle ' +
    'them live, with real performance.now() timings.',
};

// Static shell only: the site is a static export, so every workload is
// generated client-side by the seeded fixture generator — the same
// deterministic fixtures the test suite and benchmarks run against.
export default function LedgerDevPage() {
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-5 font-mono">
      <Header />
      <main id="main" className="space-y-4 py-8">
        <div className="max-w-3xl space-y-2">
          <h1 className="text-2xl font-medium">Performance lab</h1>
          <p className="text-muted-foreground text-base">
            Proof of scale, generated in your browser:{' '}
            <code>@cynco/ledger-test-data</code> builds deterministic seeded
            workloads up to 1,000,000 balanced entries, and the virtualized
            register and account tree render them with a viewport-sized DOM.
            Timings are measured live — see{' '}
            <a
              href={`${GITHUB_URL}/blob/main/PERFORMANCE.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link"
            >
              PERFORMANCE.md
            </a>{' '}
            for the benchmark inventory these components are held to.
          </p>
        </div>
        <LedgerDevClient />
      </main>
      <Footer />
    </div>
  );
}
