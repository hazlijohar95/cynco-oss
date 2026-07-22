import '@/app/prose.css';
import { preloadAccountTreeHTML } from '@cynco/accounts/ssr';
import { workloads } from '@cynco/ledger-test-data';
import type { Metadata } from 'next';

import AccountsContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import {
  ACCOUNT_TREE_DEMO_ID,
  ACCOUNTS_DOCS_TREE_ID,
} from '@/examples/entries';

const docsTitle = 'Accounts';
const docsDescription =
  'Documentation for @cynco/accounts: vanilla and React APIs, SSR ' +
  'hydration, theming, and virtualization for the chart-of-accounts tree.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

// The prose lives in content.mdx; this wrapper owns the async work the MDX
// body can't — preloading both trees' declarative shadow DOM — and hands
// the results in as props. Ids match the client demos so hydrated row ids
// line up.
export default async function AccountsDocsPage() {
  const [heroTreeHTML, densityTreeHTML] = await Promise.all([
    preloadAccountTreeHTML({
      id: ACCOUNTS_DOCS_TREE_ID,
      entries: workloads.small(),
      currency: 'MYR',
      initialExpansion: 'top-level',
    }),
    // The density demo (AccountTreeDemo) hardcodes ACCOUNT_TREE_DEMO_ID and
    // starts at default density — the state this preload renders.
    preloadAccountTreeHTML({
      id: ACCOUNT_TREE_DEMO_ID,
      entries: workloads.small(),
      currency: 'MYR',
      initialExpansion: 'top-level',
    }),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <AccountsContent
              heroTreeHTML={heroTreeHTML}
              densityTreeHTML={densityTreeHTML}
            />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
