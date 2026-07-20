import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLlmsFullTxt } from './llms/buildLlmsFullTxt';
import { buildLlmsTxt } from './llms/buildLlmsTxt';
import type {
  LlmsDocsPage,
  LlmsPackageSection,
  LlmsSite,
} from './llms/llmsTypes';
import { transformPackageDoc } from './llms/transformPackageDoc';

// Generates public/llms.txt (the https://llmstxt.org index) and
// public/llms-full.txt (all package docs concatenated) so the Next static
// export serves them at /llms.txt and /llms-full.txt. Content is assembled
// from the canonical package READMEs with versions read live from each
// package.json — the docs pages themselves are TSX and carry no extractable
// markdown. Runs via `bun scripts/generate-llms-txt.ts` before `next build`
// (see moon.yml); the outputs are gitignored build artifacts.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(SCRIPT_DIR, '..');
const PACKAGES_ROOT = join(DOCS_ROOT, '..', '..', 'packages');

const SITE: LlmsSite = {
  title: 'Cynco',
  summary:
    'TypeScript UI packages for double-entry ledgers: journal entries and ' +
    'virtualized account registers (@cynco/journals), a path-first ' +
    'chart-of-accounts tree (@cynco/accounts), and runtime theming with ' +
    'colorblind-safe role sets (@cynco/theming + @cynco/theme). Vanilla ' +
    'core, React adapters, SSR built in.',
  baseUrl: 'https://ledger.cynco.dev',
  githubUrl: 'https://github.com/hazlijohar95/cynco-oss',
  installCommand: 'pnpm add @cynco/journals @cynco/accounts',
  notes: [
    'Amounts are integer minor units (sen, cents) end to end; no floats ever touch a monetary value.',
    'Every journal entry balances per currency or is flagged — never silently repaired.',
    'Account paths are canonical colon-delimited strings, e.g. `Assets:Current:Cash-Maybank`.',
  ],
};

// README H2 sections that only make sense inside the monorepo (contributor
// workflow, release process). The llms audience integrates the published npm
// packages, so these are stripped from llms-full.txt.
const REPO_INTERNAL_SECTIONS = [
  'Contributing',
  'Development',
  'License',
  'Publishing',
] as const;

interface PackageDocSource {
  /** Directory name under packages/. */
  dir: string;
  /** Docs-site path for the package, or null when no dedicated page exists. */
  docsPath: string | null;
  /** Companion markdown docs appended after the README, nested one level deeper. */
  extraDocs: readonly string[];
}

const PACKAGE_SOURCES: readonly PackageDocSource[] = [
  { dir: 'journals', docsPath: '/docs/journals', extraDocs: [] },
  { dir: 'accounts', docsPath: '/docs/accounts', extraDocs: [] },
  { dir: 'theming', docsPath: '/docs/theming', extraDocs: [] },
  { dir: 'theme', docsPath: null, extraDocs: ['ACCESSIBILITY.md'] },
];

// One-line descriptions mirror each page's own <Metadata> description.
const DOCS_PAGES: readonly LlmsDocsPage[] = [
  {
    label: 'Journals docs',
    url: `${SITE.baseUrl}/docs/journals`,
    description:
      '@cynco/journals — vanilla and React APIs, SSR hydration, theming, and virtualization for journal entries and account registers',
  },
  {
    label: 'Accounts docs',
    url: `${SITE.baseUrl}/docs/accounts`,
    description:
      '@cynco/accounts — vanilla and React APIs, SSR hydration, theming, and virtualization for the chart-of-accounts tree',
  },
  {
    label: 'Theming docs',
    url: `${SITE.baseUrl}/docs/theming`,
    description:
      '@cynco/theming — runtime theme controller (light / dark / system), persistence, catalogs, and the CVD-safe role sets from @cynco/theme',
  },
  {
    label: 'Playground',
    url: `${SITE.baseUrl}/playground`,
    description:
      'paste or drop a transactions CSV and browse it as a live chart of accounts and register',
  },
];

interface PackageManifest {
  name: string;
  version: string;
  description: string;
}

// Reads the fields the generated documents need from a live package.json,
// failing loud (this is a build step) when the manifest is missing any.
function readPackageManifest(packageDir: string): PackageManifest {
  const manifestPath = join(packageDir, 'package.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const { name, version, description } = parsed;
  if (
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof description !== 'string'
  ) {
    throw new Error(`${manifestPath} is missing name/version/description`);
  }
  return { name, version, description };
}

// Assembles one package's llms-full.txt section: manifest facts plus the
// transformed README, with companion docs (e.g. theme's ACCESSIBILITY.md)
// appended one heading level deeper so they read as subsections.
function buildPackageSection(source: PackageDocSource): LlmsPackageSection {
  const packageDir = join(PACKAGES_ROOT, source.dir);
  const manifest = readPackageManifest(packageDir);

  const readme = transformPackageDoc(
    readFileSync(join(packageDir, 'README.md'), 'utf8'),
    {
      headingShift: 1,
      dropTitle: true,
      stripSections: REPO_INTERNAL_SECTIONS,
    }
  );
  const extras = source.extraDocs.map((file) =>
    transformPackageDoc(readFileSync(join(packageDir, file), 'utf8'), {
      headingShift: 2,
      dropTitle: false,
      stripSections: REPO_INTERNAL_SECTIONS,
    })
  );

  return {
    ...manifest,
    docsUrl:
      source.docsPath === null ? null : `${SITE.baseUrl}${source.docsPath}`,
    body: [readme, ...extras].join('\n\n'),
  };
}

function main(): void {
  const sections = PACKAGE_SOURCES.map(buildPackageSection);
  const generatedAt = new Date().toISOString();

  const llmsTxtPath = join(DOCS_ROOT, 'public', 'llms.txt');
  const llmsFullTxtPath = join(DOCS_ROOT, 'public', 'llms-full.txt');

  writeFileSync(llmsTxtPath, buildLlmsTxt(SITE, sections, DOCS_PAGES));
  writeFileSync(llmsFullTxtPath, buildLlmsFullTxt(SITE, sections, generatedAt));

  console.log(`wrote ${llmsTxtPath}`);
  console.log(`wrote ${llmsFullTxtPath}`);
}

main();
