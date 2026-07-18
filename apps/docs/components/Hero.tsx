'use client';

import { BookOpen, Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import journalsPackageJson from '../../../packages/journals/package.json';
import { Button } from '@/components/ui/button';

const INSTALL_COMMAND = 'pnpm add @cynco/journals';

// Two-tone ledger glyph: a solid journal page beside a 40%-opacity account
// column, echoing the debit/credit pairing the packages render.
function LedgerGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="64"
      height="32"
      viewBox="0 0 32 16"
      className="mb-2"
      aria-hidden="true"
    >
      <path
        fill="currentcolor"
        d="M15.5 16H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3h12.5v16ZM5 4a1 1 0 0 0 0 2h5.5a1 1 0 1 0 0-2H5Zm0 3.5a1 1 0 0 0 0 2h5.5a1 1 0 1 0 0-2H5ZM5 11a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2H5Z"
      />
      <path
        fill="currentcolor"
        d="M29 0a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H16.5V0H29Zm-8.5 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1Zm7 3a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm-3.5-1.5a1 1 0 0 0-1 1V11a1 1 0 1 0 2 0V6.5a1 1 0 0 0-1-1Z"
        opacity=".4"
      />
    </svg>
  );
}

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-3 pt-20 pb-10 md:pb-20 lg:max-w-4xl">
      <LedgerGlyph />

      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl lg:text-6xl">
        Beautifully engineered ledger primitives
      </h1>
      <p className="text-md text-muted-foreground mb-2 max-w-[740px] text-pretty md:text-lg lg:text-xl">
        <code>@cynco/journals</code> renders journal entries and virtualized
        account registers. <code>@cynco/accounts</code> renders the chart of
        accounts. Vanilla core, React adapters, SSR built in — and every amount
        is an exact integer. Made with love by{' '}
        <Link
          target="_blank"
          rel="noopener noreferrer"
          href="https://cynco.dev"
          className="hero-link"
        >
          Cynco Computing
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3 min-[460px]:flex-row min-[460px]:items-center">
        <button
          onClick={() => void copyToClipboard()}
          title="Copy to clipboard"
          className="inline-flex items-center gap-4 rounded-lg bg-neutral-900 px-5 py-3 font-mono text-sm tracking-tight text-white transition-colors hover:bg-neutral-800 md:text-base dark:border dark:border-white/20 dark:bg-black dark:hover:border-white/30"
        >
          <div className="size-4 min-[460px]:hidden" />
          <span className="mx-auto text-[95%] min-[460px]:mx-0">
            {INSTALL_COMMAND}
          </span>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <Button
          variant="secondary"
          asChild
          size="xl"
          className="h-11 rounded-lg px-5 text-sm md:h-12 md:text-base"
        >
          <Link href="/docs/journals">
            <BookOpen size={16} />
            Documentation
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-sm">
        Currently v{journalsPackageJson.version}
      </p>
    </section>
  );
}
