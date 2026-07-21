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
  { href: '/playground', label: 'Playground' },
  { href: '/ledger-dev', label: 'Performance lab' },
] as const;

/** The documentation subset, for the docs sidebar. */
export const DOCS_LINKS = [
  { href: '/docs/journals', label: 'Journals' },
  { href: '/docs/accounts', label: 'Accounts' },
  { href: '/docs/statements', label: 'Statements' },
  { href: '/docs/theming', label: 'Theming' },
] as const;
