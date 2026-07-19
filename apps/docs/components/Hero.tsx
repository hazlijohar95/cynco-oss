'use client';

import Link from 'next/link';
import { useState } from 'react';

import journalsPackageJson from '../../../packages/journals/package.json';
import { GITHUB_URL } from './Header';

const INSTALL_COMMAND = 'pnpm add @cynco/journals @cynco/accounts';

// Copy affordance for the install chip: faint copy glyph that swaps to the
// success green while the copied state is live.
function CopyStatus({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        aria-hidden="true"
        className="text-success shrink-0"
      >
        <path d="M5 12.5L10 17.5L19 7" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      className="text-text-weak shrink-0"
    >
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15H4V4h11v1" />
    </svg>
  );
}

// Hero in the opencode /data style: an oversized headline and right-aligned
// summary knocked out of a 6px pixel-pattern band, followed by a layer-2
// install chip and the glossy contrast/neutral button pair.
export function Hero() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section className="flex flex-col gap-6 px-6 pt-20 pb-10 md:gap-5 md:px-8 md:pt-24 md:pb-8 lg:px-10">
      {/* The knockout canvas: on desktop the h1 (top-left) and summary
       * (bottom-right) sit on page-background plates layered over the
       * centered pattern band, exactly like the /data hero. */}
      <div className="flex flex-col gap-6 md:relative md:block md:h-[232px] md:overflow-hidden">
        <h1 className="text-foreground md:bg-background order-1 text-[38px] leading-none font-medium md:absolute md:top-0 md:left-0 md:z-[1] md:w-max md:max-w-full md:pr-3 md:pb-3 md:text-[64px] md:whitespace-nowrap">
          Ledger primitives
        </h1>
        <div
          aria-hidden="true"
          className="pixel-pattern order-2 w-full max-md:h-4 md:absolute md:top-1/2 md:left-1/2 md:h-[351px] md:w-[1280px] md:-translate-x-1/2 md:-translate-y-1/2"
        />
        <p className="text-muted-foreground md:bg-background order-3 text-base leading-normal md:absolute md:right-0 md:bottom-0 md:z-[1] md:w-[min(563px,100%)] md:pt-3 md:pl-4 md:text-right">
          <code>@cynco/journals</code> renders journal entries and virtualized
          registers. <code>@cynco/accounts</code> renders the chart of accounts.
          Vanilla TypeScript core, React adapters, declarative shadow DOM SSR.
          Amounts are integer minor units — no floats, anywhere.
        </p>
      </div>

      {/* Install chip, styled like the /data hero-meta ticker chip. Wraps
       * on narrow viewports so the command is never truncated. */}
      <button
        onClick={() => void copyToClipboard()}
        title="Copy to clipboard"
        className="bg-accent text-muted-foreground flex w-fit max-w-full cursor-pointer items-center gap-2 border-0 px-2 py-1 text-left text-[13px] leading-[1.3] font-medium sm:h-6 sm:overflow-hidden sm:py-0 sm:leading-[1.1] sm:whitespace-nowrap"
      >
        <span className="text-text-weak" aria-hidden="true">
          $
        </span>
        <span className="break-words sm:overflow-hidden sm:text-ellipsis">
          {INSTALL_COMMAND}
        </span>
        <CopyStatus copied={copied} />
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Install command copied to clipboard' : ''}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/docs/journals" className="btn-data btn-data-contrast">
          <strong>Read the docs</strong>
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-data btn-data-neutral"
        >
          <strong>GitHub</strong>
          <span>[MIT]</span>
        </a>
      </div>

      <p className="text-text-weak text-[11px] leading-none">
        v{journalsPackageJson.version} · MIT · TypeScript · web components +
        React
      </p>
    </section>
  );
}
