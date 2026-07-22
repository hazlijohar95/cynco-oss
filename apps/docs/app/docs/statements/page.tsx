import '@/app/prose.css';
import type { Metadata } from 'next';

import StatementsContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Statements';
const docsDescription =
  'Documentation for @cynco/statements: trial balance, income statement, ' +
  'and balance sheet derivations plus vanilla and React renderers — per ' +
  'currency, computed proofs, flagged never plugged.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

export default function StatementsDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <StatementsContent />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
