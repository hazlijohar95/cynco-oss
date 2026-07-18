import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { GITHUB_URL } from './Header';

const linkClass =
  'text-muted-foreground hover:text-foreground text-sm transition-colors';

const externalLinkClass = `${linkClass} inline-flex items-center gap-0.5`;

export function Footer() {
  return (
    <footer className="pt-12 pb-12">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6 md:justify-between">
        <div className="text-muted-foreground col-span-2 text-sm md:col-span-1">
          &copy; {new Date().getFullYear()} Cynco
        </div>
        <div className="hidden md:col-span-2 md:block" />
        <div>
          <h4 className="mb-2 text-sm font-medium">Journals</h4>
          <nav className="flex flex-col gap-1">
            <Link href="/" className={linkClass}>
              Home
            </Link>
            <Link href="/docs/journals" className={linkClass}>
              Docs
            </Link>
            <Link href="/playground" className={linkClass}>
              Playground
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Accounts</h4>
          <nav className="flex flex-col gap-1">
            <Link href="/docs/accounts" className={linkClass}>
              Docs
            </Link>
            <Link href="/playground" className={linkClass}>
              Playground
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Community</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={externalLinkClass}
            >
              GitHub
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
            <Link
              href="https://cynco.dev"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLinkClass}
            >
              Cynco
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
