import '@/app/prose.css';
import type { Metadata } from 'next';

import AccountsContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Accounts';
const docsDescription =
  'Documentation for @cynco/accounts: vanilla and React APIs, SSR ' +
  'hydration, theming, and virtualization for the chart-of-accounts tree.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

export default function AccountsDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <AccountsContent />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
