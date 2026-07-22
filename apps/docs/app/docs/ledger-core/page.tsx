import '@/app/prose.css';
import type { Metadata } from 'next';

import LedgerCoreContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Ledger core';
const docsDescription =
  'Documentation for @cynco/ledger-core: the double-entry data model, ' +
  'integer-minor-unit money kernel, entry and account stores, and statement ' +
  'derivations every Cynco package builds on.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

export default function LedgerCoreDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <LedgerCoreContent />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
