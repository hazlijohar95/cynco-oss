import Link from 'next/link';

import journalsPackageJson from '../../../packages/journals/package.json';
import { InstallCommand } from './InstallCommand';
import { GITHUB_URL } from '@/lib/site';

const INSTALL_COMMAND = 'pnpm add @cynco/journals @cynco/accounts';

// Hero in the opencode /data style: an oversized headline and right-aligned
// summary knocked out of a 6px pixel-pattern band, followed by a layer-2
// install chip and the glossy contrast/neutral button pair. A server
// component — the copy chip is the only client leaf — so the version read
// from package.json never ships to the browser bundle.
export function Hero() {
  return (
    <section className="flex flex-col gap-6 px-6 pt-20 pb-10 md:gap-5 md:px-10 md:pt-24 md:pb-8 lg:px-12">
      {/* The knockout canvas: on desktop the h1 (top-left) and summary
       * (bottom-right) sit on page-background plates layered over the
       * centered pattern band, exactly like the /data hero. The stack
       * tightens to gap-5 at md because the absolutely-positioned canvas
       * already carries its own internal air; every sibling below it reads
       * closer to the 232px band than the mobile flow needs. */}
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
      <InstallCommand command={INSTALL_COMMAND} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/docs/journals" className="btn-data btn-data-contrast">
          <strong>Get started</strong>
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
