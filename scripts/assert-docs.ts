import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTags } from './assert-wiring';

// Docs-coverage guard: every public export of a publishable package must be
// MENTIONED in that package's docs page, and every publishable package must
// have a docs page wired into the site. The docs pages were audited at ~19%
// export coverage — 13 of 16 sampled @cynco/journals exports had zero docs
// mention — because nothing made an export and its documentation move
// together: adding `export * from './newUtil'` to an index.ts touched no
// file any check looked at. This script is that check.
//
// "Mentioned" is deliberately the whole contract: a word-boundary match of
// the export name anywhere in the page's content.mdx. A mention proves a
// human placed the name into the reference (an options table row, a
// utilities-index line, a types list) — the guard cannot judge prose
// quality, and pretending to (line-count minimums, section anchors) would
// only teach people to satisfy the metric. Names are parsed from source
// TEXT, never by importing the packages: the guard must run pre-build and
// must not care whether dist exists (the assert-lockstep precedent).

/** One workspace package the guard covers. */
export interface DocsPackage {
  /** @cynco package name, e.g. "@cynco/journals". */
  name: string;
  /** packages/<dir>; also the default docs page slug. */
  dir: string;
}

export interface DocsViolation {
  /** Which rule broke (used to group the report). */
  rule: string;
  /** Actionable message naming the file and the exact entry to add. */
  message: string;
}

/**
 * Packages whose exports are documented on ANOTHER package's docs page.
 * Every entry needs a reason — this is a sanctioned redirect, not a skip:
 * the target page must still mention every export of the mapped package.
 */
export const DOCS_PAGE_OVERRIDES: Readonly<
  Record<string, { page: string; reason: string }>
> = {
  theme: {
    page: 'theming',
    reason:
      '@cynco/theme is the theming page’s paired package: its role sets, ' +
      'palettes, and color-science helpers are documented in the theming ' +
      'page’s "From @cynco/theme" reference section.',
  },
};

/**
 * The escape hatch that keeps this guard honest instead of noisy: an export
 * deliberately left out of the docs goes here, keyed by package dir, with a
 * real reason ("internal wiring, exported for tests", "superseded, kept for
 * back-compat"). Empty today — every current export is mentioned on its
 * page, with genuinely-internal ones marked as such in the reference — but
 * the mechanism must exist BEFORE the first exception does, or the first
 * exception becomes a reason to weaken the check itself. Stale entries
 * (name gone, or name now mentioned) fail the guard so the list cannot rot
 * into a blanket waiver.
 */
export const DOCS_MENTION_ALLOWLIST: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {};

/**
 * Export names collected from one module's source text: `export
 * const/function/class/interface/type/enum/let/var X` declarations plus
 * `export { a, b as c, type D }` lists (re-export sources do not matter —
 * the name is public either way). Text-based like assert-lockstep: no
 * TypeScript compiler API, so the guard stays a milliseconds-fast text scan
 * with zero build prerequisites. The trade-off is that only top-level
 * `export` syntax is recognized — which is exactly how every src/index.ts
 * in this repo is written.
 */
export function parseNamedExports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const rawItem of (match[1] ?? '').split(',')) {
      const item = rawItem.trim();
      if (item === '') {
        continue;
      }
      // `a as b` exports `b`; `type X` exports `X`. The published name is
      // always the LAST identifier of the item.
      const aliased = /(?:^|\s)as\s+(\w+)\s*$/.exec(item);
      if (aliased != null) {
        names.push(aliased[1] ?? '');
        continue;
      }
      const plain = /^(?:type\s+)?(\w+)/.exec(item);
      if (plain != null) {
        names.push(plain[1] ?? '');
      }
    }
  }
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|function\*?|class|interface|type|enum|let|var)\s+(\w+)/gm
  )) {
    names.push(match[1] ?? '');
  }
  return names;
}

/** Relative specifiers of `export * from './x'` / `export type * from './x'`. */
export function parseStarExportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(
    /^export\s+(?:type\s+)?\*\s+from\s+'([^']+)'/gm
  )) {
    specifiers.push(match[1] ?? '');
  }
  return specifiers;
}

export interface PublicExports {
  /** Deduplicated public export names, sorted. */
  names: string[];
  /** Star-export specifiers whose module text could not be loaded. */
  unresolved: string[];
  /**
   * Relative star-exports found INSIDE a followed module. The guard follows
   * `export * from './x'` exactly one level (every index.ts in this repo is
   * flat); a nested star would silently hide names, so it is reported
   * instead of ignored.
   */
  nestedStars: string[];
}

/**
 * The public export surface of a package, from its index source: named
 * exports of the index itself plus the named exports of every module a
 * relative star-export points at (one level). `readModule` returns a
 * module's source text for a specifier, or null when it cannot — injected
 * so the pure logic is testable without a filesystem. Non-relative star
 * specifiers land in `unresolved`: a surface the guard cannot enumerate
 * must fail loud, never pass empty.
 */
export function collectPublicExports(
  indexSource: string,
  readModule: (specifier: string) => string | null
): PublicExports {
  const names = new Set<string>(parseNamedExports(indexSource));
  const unresolved: string[] = [];
  const nestedStars: string[] = [];
  for (const specifier of parseStarExportSpecifiers(indexSource)) {
    if (!specifier.startsWith('.')) {
      unresolved.push(specifier);
      continue;
    }
    const moduleSource = readModule(specifier);
    if (moduleSource == null) {
      unresolved.push(specifier);
      continue;
    }
    for (const name of parseNamedExports(moduleSource)) {
      names.add(name);
    }
    for (const nested of parseStarExportSpecifiers(moduleSource)) {
      nestedStars.push(`${specifier} -> ${nested}`);
    }
  }
  return {
    names: [...names].sort(),
    unresolved,
    nestedStars,
  };
}

/**
 * Word-boundary mention test. Export names are `\w+` identifiers, so `\b`
 * is exact: `Register` does NOT match inside `RegisterOptions`, and a
 * mention inside a code span, a table cell, or prose all count equally —
 * the guard checks presence, not placement.
 */
export function isMentioned(name: string, mdxText: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(mdxText);
}

/**
 * Check 1: every export name is mentioned in the package's docs page or
 * carries an allowlist reason.
 */
export function findUndocumentedExports(
  pkg: DocsPackage,
  page: string,
  names: readonly string[],
  mdxText: string,
  allowlist: Readonly<Record<string, string>>
): DocsViolation[] {
  const violations: DocsViolation[] = [];
  for (const name of names) {
    if (Object.hasOwn(allowlist, name) || isMentioned(name, mdxText)) {
      continue;
    }
    violations.push({
      rule: 'export-mentioned',
      message:
        `${pkg.name} exports \`${name}\` but apps/docs/app/docs/${page}/content.mdx ` +
        `never mentions it — add it to the page's API reference, or add an ` +
        `allowlist entry with a reason in scripts/assert-docs.ts.`,
    });
  }
  return violations;
}

/**
 * Check 2: the allowlist cannot rot. An entry whose export no longer exists
 * is stale; an entry whose export IS mentioned no longer needs the waiver —
 * both must be removed, or the list slowly becomes a blanket exemption
 * nobody re-reads.
 */
export function findStaleAllowlistEntries(
  pkg: DocsPackage,
  page: string,
  names: readonly string[],
  mdxText: string,
  allowlist: Readonly<Record<string, string>>
): DocsViolation[] {
  const violations: DocsViolation[] = [];
  const nameSet = new Set(names);
  for (const name of Object.keys(allowlist)) {
    if (!nameSet.has(name)) {
      violations.push({
        rule: 'allowlist-stale',
        message:
          `DOCS_MENTION_ALLOWLIST['${pkg.dir}'] lists \`${name}\`, but ` +
          `${pkg.name} no longer exports it — remove the stale entry.`,
      });
    } else if (isMentioned(name, mdxText)) {
      violations.push({
        rule: 'allowlist-stale',
        message:
          `DOCS_MENTION_ALLOWLIST['${pkg.dir}'] lists \`${name}\`, but ` +
          `apps/docs/app/docs/${page}/content.mdx already mentions it — the ` +
          `waiver is dead weight, remove it.`,
      });
    }
  }
  return violations;
}

/**
 * Hrefs of the DOCS_ORDER block in apps/docs/lib/site.ts — the single list
 * DOCS_LINKS, the /docs index, the sidebar, and pagination all render from.
 * Anchored on the exported declaration and sliced to its closing bracket so
 * SITE_LINKS entries never leak in. Returns [] when the anchor is missing;
 * the caller treats that as a hard error (an unparseable list must never
 * look like an empty, trivially-satisfied one — the assert-wiring rule).
 */
export function parseDocsOrderHrefs(siteSource: string): string[] {
  const anchor = siteSource.indexOf('export const DOCS_ORDER');
  if (anchor === -1) {
    return [];
  }
  const rest = siteSource.slice(anchor);
  const end = rest.indexOf('] as const');
  const block = end === -1 ? rest : rest.slice(0, end);
  const hrefs: string[] = [];
  for (const match of block.matchAll(/href:\s*'([^']+)'/g)) {
    hrefs.push(match[1] ?? '');
  }
  return hrefs;
}

/**
 * Check 3: every published package has a docs page — content.mdx exists for
 * its (possibly overridden) page slug, and that page is reachable through
 * DOCS_LINKS via the DOCS_ORDER hrefs. A package published without a page
 * is undocumentable by definition; a page missing from DOCS_ORDER renders
 * but is unreachable from the sidebar, pagination, and the /docs index.
 */
export function findMissingDocsPages(
  packages: readonly DocsPackage[],
  pageExists: (page: string) => boolean,
  docsOrderHrefs: readonly string[]
): DocsViolation[] {
  const violations: DocsViolation[] = [];
  for (const pkg of packages) {
    const page = DOCS_PAGE_OVERRIDES[pkg.dir]?.page ?? pkg.dir;
    if (!pageExists(page)) {
      violations.push({
        rule: 'docs-page-exists',
        message:
          `${pkg.name} is publishable but apps/docs/app/docs/${page}/content.mdx ` +
          `does not exist — every published package needs a docs page (or a ` +
          `DOCS_PAGE_OVERRIDES entry pointing at the page that covers it).`,
      });
      continue;
    }
    if (!docsOrderHrefs.includes(`/docs/${page}`)) {
      violations.push({
        rule: 'docs-page-linked',
        message:
          `${pkg.name}'s docs page /docs/${page} is not in DOCS_ORDER in ` +
          `apps/docs/lib/site.ts — the sidebar, pagination, and /docs index ` +
          `all render from that list, so the page is unreachable.`,
      });
    }
  }
  return violations;
}

// --- Filesystem driver ------------------------------------------------------

/** Resolves a relative module specifier the way the bundler does. */
function readModuleFile(pkgSrc: string, specifier: string): string | null {
  const base = join(pkgSrc, specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

function loadPublishablePackages(packagesDir: string): DocsPackage[] {
  const packages: DocsPackage[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = entry.name;
    let moonYml: string;
    let manifestText: string;
    try {
      moonYml = readFileSync(join(packagesDir, dir, 'moon.yml'), 'utf8');
      manifestText = readFileSync(
        join(packagesDir, dir, 'package.json'),
        'utf8'
      );
    } catch {
      continue; // not a full package dir
    }
    if (!parseTags(moonYml).includes('publishable')) {
      continue;
    }
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    packages.push({ name: manifest['name'] as string, dir });
  }
  return packages;
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDir, '..');
  const docsPagesDir = join(root, 'apps', 'docs', 'app', 'docs');

  const packages = loadPublishablePackages(join(root, 'packages'));
  if (packages.length === 0) {
    console.error(
      'assert-docs: found no publishable packages under packages/ — the ' +
        "guard anchors on the 'publishable' moon.yml tag."
    );
    process.exit(1);
  }

  const siteSource = readFileSync(
    join(root, 'apps', 'docs', 'lib', 'site.ts'),
    'utf8'
  );
  const docsOrderHrefs = parseDocsOrderHrefs(siteSource);
  if (docsOrderHrefs.length === 0) {
    console.error(
      'assert-docs: could not parse DOCS_ORDER hrefs from ' +
        'apps/docs/lib/site.ts — the guard anchors on `export const ' +
        "DOCS_ORDER` with `href: '…'` entries."
    );
    process.exit(1);
  }

  const violations: DocsViolation[] = [
    ...findMissingDocsPages(
      packages,
      (page) => existsSync(join(docsPagesDir, page, 'content.mdx')),
      docsOrderHrefs
    ),
  ];

  let exportCount = 0;
  for (const pkg of packages) {
    const page = DOCS_PAGE_OVERRIDES[pkg.dir]?.page ?? pkg.dir;
    const mdxPath = join(docsPagesDir, page, 'content.mdx');
    if (!existsSync(mdxPath)) {
      continue; // already reported by findMissingDocsPages
    }
    const pkgSrc = join(root, 'packages', pkg.dir, 'src');
    const indexSource = readFileSync(join(pkgSrc, 'index.ts'), 'utf8');
    const surface = collectPublicExports(indexSource, (specifier) =>
      readModuleFile(pkgSrc, specifier)
    );
    for (const specifier of surface.unresolved) {
      violations.push({
        rule: 'export-surface',
        message:
          `${pkg.name}: cannot enumerate \`export * from '${specifier}'\` in ` +
          `src/index.ts — an unenumerable surface must not pass silently; ` +
          `re-export the names explicitly or teach the guard the resolution.`,
      });
    }
    for (const nested of surface.nestedStars) {
      violations.push({
        rule: 'export-surface',
        message:
          `${pkg.name}: nested star re-export (${nested}) is beyond the ` +
          `guard's one-level follow — flatten it into src/index.ts or ` +
          `deepen collectPublicExports.`,
      });
    }
    const mdxText = readFileSync(mdxPath, 'utf8');
    const allowlist = DOCS_MENTION_ALLOWLIST[pkg.dir] ?? {};
    exportCount += surface.names.length;
    violations.push(
      ...findUndocumentedExports(pkg, page, surface.names, mdxText, allowlist),
      ...findStaleAllowlistEntries(pkg, page, surface.names, mdxText, allowlist)
    );
  }

  if (violations.length > 0) {
    console.error(
      'Docs-coverage violations (an export and its docs drifted apart):'
    );
    for (const violation of violations) {
      console.error(`  [${violation.rule}] ${violation.message}`);
    }
    process.exit(1);
  }

  console.log(
    `Docs OK — ${packages.length} publishable packages, ${exportCount} ` +
      `public exports all mentioned in their docs pages (or allowlisted ` +
      `with reasons); every package has a linked docs page.`
  );
}

if (import.meta.main) {
  main();
}
