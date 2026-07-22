import '@/app/prose.css';
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';
import type { Metadata } from 'next';

import JournalsContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import { PAYROLL_ENTRY } from '@/examples/entries';

const docsTitle = 'Journals';
const docsDescription =
  'Documentation for @cynco/journals: vanilla and React APIs, SSR ' +
  'hydration, theming, and virtualization for journal entries and account ' +
  'registers.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

// The prose lives in content.mdx; this wrapper owns the async work the MDX
// body can't — preloading the hero demo's declarative shadow DOM — and
// hands it in as a prop.
export default async function JournalsDocsPage() {
  const heroEntryHTML = await preloadJournalEntryHTML(PAYROLL_ENTRY, {
    showLineNumbers: true,
  });

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <JournalsContent heroEntryHTML={heroEntryHTML} />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
