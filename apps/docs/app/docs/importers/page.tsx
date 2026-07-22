import '@/app/prose.css';
import type { Metadata } from 'next';

import ImportersContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Importers';
const docsDescription =
  'Documentation for @cynco/importers: CSV and OFX bank statement parsers ' +
  'producing statement lines and balanced draft entries — integer minor ' +
  'units, running-balance proof, typed fail-loud errors.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

export default function ImportersDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <ImportersContent />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
