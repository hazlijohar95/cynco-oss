import Link from 'next/link';

import journalsPackageJson from '../../../packages/journals/package.json';
import { CyncoMark } from './CyncoMark';
import { ThemeToggleGroup } from './ThemeToggleGroup';
import { GITHUB_URL, SITE_LINKS } from '@/lib/site';
import { cn } from '@/lib/utils';

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

const RESOURCE_LINKS: readonly FooterLink[] = [
  { href: GITHUB_URL, label: 'GitHub', external: true },
  {
    href: 'https://www.npmjs.com/package/@cynco/journals',
    label: 'npm: @cynco/journals',
    external: true,
  },
  {
    href: 'https://www.npmjs.com/package/@cynco/accounts',
    label: 'npm: @cynco/accounts',
    external: true,
  },
];

const COMPANY_LINKS: readonly FooterLink[] = [
  { href: 'https://cynco.dev', label: 'cynco.dev', external: true },
  { href: 'mailto:coding@hazli.dev', label: 'Contact' },
];

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly FooterLink[];
}) {
  return (
    <div className="grid min-w-0 content-start gap-4.5">
      <h2 className="text-foreground text-[11px] leading-none font-medium">
        {title}
      </h2>
      <nav aria-label={title} className="grid content-start gap-3">
        {links.map(({ href, label, external }) => (
          <Link
            key={label}
            href={href}
            {...(external === true
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})}
            className="text-muted-foreground hover:text-foreground block w-fit text-[11px] leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export interface FooterProps {
  /** Horizontal padding lives on the caller: the home page's edge-to-edge
   * container passes the section gutters, while padded page containers
   * (docs, playground, perf lab) pass nothing so the footer's left edge
   * stays flush with the content above it. */
  className?: string;
}

// Footer in the opencode /data style: brand mark + link-column grid in 11px
// mono, a 6px pixel-pattern band, then a bottom row with copyright, a green
// release-status square, and the three-state theme toggle.
export function Footer({ className }: FooterProps) {
  return (
    <footer className={cn('grid gap-14 pt-24 pb-6 font-mono', className)}>
      <div className="grid grid-cols-2 items-start gap-10 sm:grid-cols-[80px_repeat(3,minmax(0,1fr))] sm:gap-12 lg:gap-16">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Cynco on GitHub"
          className="text-foreground col-span-2 block w-fit focus-visible:outline-2 focus-visible:outline-offset-2 sm:col-span-1"
        >
          <CyncoMark size={40} />
        </a>
        <FooterColumn title="Library" links={SITE_LINKS} />
        <FooterColumn title="Resources" links={RESOURCE_LINKS} />
        <FooterColumn title="Cynco" links={COMPANY_LINKS} />
      </div>

      <div className="pixel-pattern h-4" aria-hidden="true" />

      <div className="flex flex-wrap items-center justify-between gap-6 text-[11px] leading-none">
        <div className="flex flex-wrap items-center gap-6">
          <span>&copy; {new Date().getFullYear()} Cynco</span>
          <span className="flex items-center gap-2.5">
            <i aria-hidden="true" className="bg-success block h-1.5 w-1.5" />
            <span className="sr-only">Latest release:</span>v
            {journalsPackageJson.version}
          </span>
          <span className="text-muted-foreground">
            typeface:{' '}
            <Link
              href="https://github.com/paper-design/paper-mono"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline decoration-1 underline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Paper Mono
            </Link>
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-3">
          <ThemeToggleGroup />
        </div>
      </div>
    </footer>
  );
}
