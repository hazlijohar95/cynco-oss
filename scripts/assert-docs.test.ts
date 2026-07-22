import { describe, expect, test } from 'bun:test';

import {
  collectPublicExports,
  type DocsPackage,
  findMissingDocsPages,
  findStaleAllowlistEntries,
  findUndocumentedExports,
  isMentioned,
  parseDocsOrderHrefs,
  parseNamedExports,
  parseStarExportSpecifiers,
} from './assert-docs';

const pkg = (name: string, dir: string): DocsPackage => ({ name, dir });

describe('parseNamedExports', () => {
  test('collects declaration exports across kinds', () => {
    const source = [
      'export const JOURNALS_TAG_NAME = "journals-container";',
      'export function formatMinorUnits(amount: number): string {',
      'export class SmoothScroller {',
      'export interface RegisterOptions {',
      "export type RegisterDensity = 'comfortable' | 'compact';",
      'export enum Unused {',
    ].join('\n');
    expect(parseNamedExports(source)).toEqual([
      'JOURNALS_TAG_NAME',
      'formatMinorUnits',
      'SmoothScroller',
      'RegisterOptions',
      'RegisterDensity',
      'Unused',
    ]);
  });

  test('collects list exports with aliases and type markers', () => {
    const source = [
      "export { applyThemeToElement, type ApplyThemeOptions } from './apply';",
      "export type { ColorMode, ThemeCatalog } from './types';",
      "export { internalName as publicName } from './impl';",
    ].join('\n');
    expect(parseNamedExports(source)).toEqual([
      'applyThemeToElement',
      'ApplyThemeOptions',
      'ColorMode',
      'ThemeCatalog',
      'publicName',
    ]);
  });

  test('handles multi-line export lists', () => {
    const source = [
      'export {',
      '  checkBalanceAssertions,',
      '  createAccountTaxonomy,',
      "} from '@cynco/ledger-core';",
    ].join('\n');
    expect(parseNamedExports(source)).toEqual([
      'checkBalanceAssertions',
      'createAccountTaxonomy',
    ]);
  });

  test('ignores non-export lines', () => {
    expect(parseNamedExports("import { join } from 'node:path';")).toEqual([]);
  });
});

describe('parseStarExportSpecifiers', () => {
  test('collects star and type-star specifiers', () => {
    const source = [
      "export * from './components/Register';",
      "export type * from './types';",
      "export { one } from './named';",
    ].join('\n');
    expect(parseStarExportSpecifiers(source)).toEqual([
      './components/Register',
      './types',
    ]);
  });
});

describe('collectPublicExports', () => {
  const modules: Record<string, string> = {
    './register':
      'export class Register {}\nexport interface RegisterOptions {}',
    './types': 'export type MinorUnits = number;',
    './nested': "export const x = 1;\nexport * from './deeper';",
  };
  const readModule = (specifier: string): string | null =>
    modules[specifier] ?? null;

  test('merges index names with one-level star-followed names, sorted', () => {
    const index = [
      'export const DEFAULT_OVERSCAN_ROWS = 10;',
      "export * from './register';",
      "export type * from './types';",
    ].join('\n');
    const surface = collectPublicExports(index, readModule);
    expect(surface.names).toEqual([
      'DEFAULT_OVERSCAN_ROWS',
      'MinorUnits',
      'Register',
      'RegisterOptions',
    ]);
    expect(surface.unresolved).toEqual([]);
    expect(surface.nestedStars).toEqual([]);
  });

  test('reports unresolved relative and non-relative star specifiers', () => {
    const index = [
      "export * from './missing';",
      "export * from '@cynco/ledger-core';",
    ].join('\n');
    const surface = collectPublicExports(index, readModule);
    expect(surface.unresolved).toEqual(['./missing', '@cynco/ledger-core']);
  });

  test('reports nested star re-exports instead of silently skipping them', () => {
    const surface = collectPublicExports(
      "export * from './nested';",
      readModule
    );
    expect(surface.names).toEqual(['x']);
    expect(surface.nestedStars).toEqual(['./nested -> ./deeper']);
  });
});

describe('isMentioned', () => {
  test('matches on word boundaries only', () => {
    expect(isMentioned('Register', 'the `Register` class')).toBe(true);
    // `Register` inside `RegisterOptions` is a different identifier — a
    // mention of the options type must not count as documenting the class.
    expect(isMentioned('Register', 'see RegisterOptions')).toBe(false);
    expect(isMentioned('RegisterOptions', 'see RegisterOptions')).toBe(true);
  });

  test('counts mentions in table cells and code fences alike', () => {
    expect(isMentioned('formatMinorUnits', '| `formatMinorUnits(a)` |')).toBe(
      true
    );
  });
});

describe('findUndocumentedExports', () => {
  const journals = pkg('@cynco/journals', 'journals');

  test('flags an export the page never mentions', () => {
    const violations = findUndocumentedExports(
      journals,
      'journals',
      ['diffWords', 'Register'],
      'Only the `Register` is documented here.',
      {}
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('diffWords');
    expect(violations[0]?.message).toContain(
      'apps/docs/app/docs/journals/content.mdx'
    );
  });

  test('accepts an allowlisted export with a reason', () => {
    const violations = findUndocumentedExports(
      journals,
      'journals',
      ['internalHelper'],
      'No mention.',
      { internalHelper: 'internal wiring, exported for tests' }
    );
    expect(violations).toEqual([]);
  });

  test('passes when every export is mentioned', () => {
    const violations = findUndocumentedExports(
      journals,
      'journals',
      ['Register', 'diffWords'],
      '`Register` and `diffWords(before, after)`.',
      {}
    );
    expect(violations).toEqual([]);
  });
});

describe('findStaleAllowlistEntries', () => {
  const journals = pkg('@cynco/journals', 'journals');

  test('flags an entry whose export no longer exists', () => {
    const violations = findStaleAllowlistEntries(
      journals,
      'journals',
      ['Register'],
      '`Register`.',
      { removedExport: 'was internal' }
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('removedExport');
    expect(violations[0]?.message).toContain('no longer exports');
  });

  test('flags an entry whose export is now mentioned in the docs', () => {
    const violations = findStaleAllowlistEntries(
      journals,
      'journals',
      ['Register'],
      '`Register` is documented now.',
      { Register: 'not documented yet' }
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('dead weight');
  });

  test('accepts a live waiver: export exists and is not mentioned', () => {
    const violations = findStaleAllowlistEntries(
      journals,
      'journals',
      ['internalHelper'],
      'No mention.',
      { internalHelper: 'internal wiring, exported for tests' }
    );
    expect(violations).toEqual([]);
  });
});

describe('parseDocsOrderHrefs', () => {
  test('reads hrefs from the DOCS_ORDER block only', () => {
    const source = [
      'export const SITE_LINKS = [',
      "  { href: '/playground', label: 'Playground' },",
      '] as const;',
      '',
      'export const DOCS_ORDER = [',
      "  { href: '/docs/journals', label: 'Journals' },",
      "  { href: '/docs/theming', label: 'Theming' },",
      '] as const;',
    ].join('\n');
    expect(parseDocsOrderHrefs(source)).toEqual([
      '/docs/journals',
      '/docs/theming',
    ]);
  });

  test('returns [] when the anchor is missing (caller fails loud)', () => {
    expect(parseDocsOrderHrefs('export const OTHER = [];')).toEqual([]);
  });
});

describe('findMissingDocsPages', () => {
  const packages = [
    pkg('@cynco/journals', 'journals'),
    pkg('@cynco/theme', 'theme'),
  ];

  test('accepts existing pages, honoring DOCS_PAGE_OVERRIDES for theme', () => {
    const violations = findMissingDocsPages(
      packages,
      (page) => page === 'journals' || page === 'theming',
      ['/docs/journals', '/docs/theming']
    );
    expect(violations).toEqual([]);
  });

  test('flags a publishable package with no content.mdx', () => {
    const violations = findMissingDocsPages(
      packages,
      (page) => page === 'theming',
      ['/docs/theming']
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('docs-page-exists');
    expect(violations[0]?.message).toContain('journals/content.mdx');
  });

  test('flags a page missing from DOCS_ORDER', () => {
    const violations = findMissingDocsPages(packages, () => true, [
      '/docs/theming',
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('docs-page-linked');
    expect(violations[0]?.message).toContain('/docs/journals');
  });
});
