import '@/app/prose.css';
import {
  preloadEntryDiffHTML,
  preloadJournalEntryHTML,
} from '@cynco/journals/ssr';
import type { Metadata } from 'next';

import JournalsContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import {
  FIT_OUT_ENTRY_AFTER,
  FIT_OUT_ENTRY_BEFORE,
  PAYROLL_ENTRY,
} from '@/examples/entries';

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
// body can't — preloading the demos' declarative shadow DOM — and hands the
// results in as props.
export default async function JournalsDocsPage() {
  const [heroEntryHTML, entryDiffHTML] = await Promise.all([
    preloadJournalEntryHTML(PAYROLL_ENTRY, { showLineNumbers: true }),
    preloadEntryDiffHTML(FIT_OUT_ENTRY_BEFORE, FIT_OUT_ENTRY_AFTER),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <JournalsContent
              heroEntryHTML={heroEntryHTML}
              entryDiffHTML={entryDiffHTML}
            />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
