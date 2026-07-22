// Site-wide constants shared by server and client components. Header
// previously owned these from a 'use client' file, which dragged pure
// values through the client boundary for every server component that
// imported them.

export const GITHUB_URL = 'https://github.com/hazlijohar95/cynco-oss';

/** Every top-level route, in nav order. Header, footer, and sitemap-style
 * surfaces all render from this one list so labels can't drift. */
export const SITE_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs/journals', label: 'Journals' },
  { href: '/docs/accounts', label: 'Accounts' },
  { href: '/docs/statements', label: 'Statements' },
  { href: '/docs/theming', label: 'Theming' },
  { href: '/docs/importers', label: 'Importers' },
  { href: '/playground', label: 'Playground' },
  { href: '/ledger-dev', label: 'Performance lab' },
] as const;

/** The documentation pages in reading order — the /docs index renders one
 * row per entry, and the ordering is the prev/next contract for any future
 * pagination. Descriptions are the packages' one-line hard claims. */
export const DOCS_ORDER = [
  {
    href: '/docs/journals',
    label: 'Journals',
    packageName: '@cynco/journals',
    description:
      'Journal entries, virtualized registers, reconciliation — vanilla ' +
      'core, React adapters, declarative shadow DOM SSR.',
  },
  {
    href: '/docs/accounts',
    label: 'Accounts',
    packageName: '@cynco/accounts',
    description:
      'The chart of accounts as a virtualized, keyboard-navigable tree — ' +
      'rolled-up balances, status dots, search.',
  },
  {
    href: '/docs/statements',
    label: 'Statements',
    packageName: '@cynco/statements',
    description:
      'Trial balance, income statement, and balance sheet derived from ' +
      'entries — computed proofs, flagged never plugged.',
  },
  {
    href: '/docs/theming',
    label: 'Theming',
    packageName: '@cynco/theming',
    description:
      'Runtime theme controller (light / dark / system) with persistence, ' +
      'catalogs, and CVD-safe role sets.',
  },
  {
    href: '/docs/importers',
    label: 'Importers',
    packageName: '@cynco/importers',
    description:
      'Bank exports (CSV, OFX) to statement lines and draft entries — ' +
      'integer minor units, running-balance proof, fail loud.',
  },
] as const;

/** The docs sidebar list: the index first, then the pages in reading order. */
export const DOCS_LINKS = [
  { href: '/docs', label: 'Overview' },
  ...DOCS_ORDER.map(({ href, label }) => ({ href, label })),
] as const;
