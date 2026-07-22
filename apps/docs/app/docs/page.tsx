import '@/app/prose.css';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import { DOCS_ORDER } from '@/lib/site';

const docsTitle = 'Documentation';
const docsDescription =
  'Documentation for the Cynco ledger suite: @cynco/journals, ' +
  '@cynco/accounts, @cynco/statements, @cynco/theming, and ' +
  '@cynco/importers.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

// The docs index: one row per package in reading order (DOCS_ORDER is the
// shared source for this page, the sidebar, and any future prev/next
// pagination), each carrying the package's one-line hard claim.
export default function DocsIndexPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <h1>Documentation</h1>
            <p>
              Five packages, one contract: vanilla TypeScript cores, thin React
              adapters, declarative shadow DOM SSR, and integer minor units end
              to end — no floats ever touch money.
            </p>
            <ul className="border-border m-0 flex list-none flex-col border-t p-0 font-mono">
              {DOCS_ORDER.map(({ href, label, packageName, description }) => (
                <li key={href} className="m-0 list-none p-0">
                  <Link
                    href={href}
                    className="group border-border hover:bg-muted flex flex-col gap-1 border-b px-1 py-4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  >
                    <span className="flex items-baseline justify-between gap-4">
                      <span className="text-foreground text-[15px] font-semibold">
                        {label}
                      </span>
                      <code className="text-muted-foreground text-[12px] font-normal">
                        {packageName}
                      </code>
                    </span>
                    <span className="text-muted-foreground max-w-[60ch] text-[13px] leading-relaxed">
                      {description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
