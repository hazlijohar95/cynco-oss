import '@/app/prose.css';
import { preloadJournalEntryHTML } from '@cynco/journals/ssr';
import type { Metadata } from 'next';

import ThemingContent, { tableOfContents } from './content.mdx';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import { PAYROLL_ENTRY } from '@/examples/entries';
import { CVD_SAMPLE_ENTRY } from '@/examples/theming/fixtures';

const docsTitle = 'Theming';
const docsDescription =
  'Documentation for @cynco/theming: the runtime theme controller ' +
  '(light / dark / system), persistence, theme catalogs, DOM application ' +
  'helpers, the React hook, and the CVD-safe role sets from @cynco/theme.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

// The prose lives in content.mdx; this wrapper owns the async work the MDX
// body can't — preloading the demo cards' declarative shadow DOM — and
// hands the results in as props. The CVD comparison shares one preload
// across both panes: the theme layer is CSS variables only, so the
// shadow-root HTML is identical under every role set.
export default async function ThemingDocsPage() {
  const [switcherEntryHTML, cvdEntryHTML] = await Promise.all([
    preloadJournalEntryHTML(PAYROLL_ENTRY),
    preloadJournalEntryHTML(CVD_SAMPLE_ENTRY),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout toc={tableOfContents}>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <ThemingContent
              switcherEntryHTML={switcherEntryHTML}
              cvdEntryHTML={cvdEntryHTML}
            />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
