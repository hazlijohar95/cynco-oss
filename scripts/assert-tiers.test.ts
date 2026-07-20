import { describe, expect, test } from 'bun:test';

import {
  ALLOWED_DEPENDENCIES,
  findTierViolations,
  type PackageTier,
  parseCyncoDependencies,
  parseTier,
} from './assert-tiers';

describe('parseTier', () => {
  test('reads the tier tag from a moon.yml body', () => {
    expect(parseTier("tags: ['tsdown', 'tier-engine']")).toBe('engine');
    expect(parseTier("tags: ['tsdown', 'publishable', 'tier-domain']")).toBe(
      'domain'
    );
    expect(parseTier("tags: ['tsdown', 'tier-surface']")).toBe('surface');
    expect(parseTier("tags: ['tsdown', 'tier-fixtures']")).toBe('fixtures');
  });

  test('returns null when no tier tag is present', () => {
    expect(parseTier("tags: ['tsdown']")).toBeNull();
  });
});

describe('parseCyncoDependencies', () => {
  test('collects @cynco deps across every dependency block', () => {
    const manifest = JSON.stringify({
      name: '@cynco/accounts',
      dependencies: { '@cynco/ledger-core': 'workspace:*', react: '19' },
      devDependencies: { '@cynco/ledger-test-data': 'workspace:*' },
      peerDependencies: { '@cynco/theme': 'workspace:*' },
    });
    expect(parseCyncoDependencies(manifest).sort()).toEqual([
      '@cynco/ledger-core',
      '@cynco/ledger-test-data',
      '@cynco/theme',
    ]);
  });

  test('ignores non-@cynco deps and empty manifests', () => {
    expect(parseCyncoDependencies('{"name":"x"}')).toEqual([]);
  });
});

describe('findTierViolations', () => {
  const pkg = (
    name: string,
    tier: PackageTier['tier'],
    deps: string[]
  ): PackageTier => ({
    name,
    dir: name.split('/')[1],
    tier,
    cyncoDependencies: deps,
  });

  test('the current suite is clean', () => {
    const packages: PackageTier[] = [
      pkg('@cynco/ledger-core', 'engine', []),
      pkg('@cynco/ledger-test-data', 'fixtures', ['@cynco/ledger-core']),
      pkg('@cynco/theme', 'surface', []),
      pkg('@cynco/theming', 'surface', ['@cynco/theme']),
      pkg('@cynco/journals', 'domain', ['@cynco/theme']),
      pkg('@cynco/accounts', 'domain', [
        '@cynco/ledger-core',
        '@cynco/theme',
        '@cynco/ledger-test-data',
      ]),
    ];
    expect(findTierViolations(packages)).toEqual([]);
  });

  test('flags an engine that depends on surface (only fixtures allowed)', () => {
    const packages: PackageTier[] = [
      pkg('@cynco/ledger-core', 'engine', ['@cynco/theme']),
      pkg('@cynco/theme', 'surface', []),
    ];
    const v = findTierViolations(packages);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      from: '@cynco/ledger-core',
      to: '@cynco/theme',
      fromTier: 'engine',
      toTier: 'surface',
    });
  });

  test('flags surface reaching up into a domain package', () => {
    const packages: PackageTier[] = [
      pkg('@cynco/theme', 'surface', ['@cynco/accounts']),
      pkg('@cynco/accounts', 'domain', []),
    ];
    expect(findTierViolations(packages)).toHaveLength(1);
  });

  test('flags a domain package depending on another domain package', () => {
    const packages: PackageTier[] = [
      pkg('@cynco/accounts', 'domain', ['@cynco/journals']),
      pkg('@cynco/journals', 'domain', []),
    ];
    expect(findTierViolations(packages)).toHaveLength(1);
  });

  test('ignores unknown @cynco deps (external packages)', () => {
    const packages: PackageTier[] = [
      pkg('@cynco/accounts', 'domain', ['@cynco/icons']),
    ];
    expect(findTierViolations(packages)).toEqual([]);
  });
});

describe('ALLOWED_DEPENDENCIES matrix', () => {
  test('engines depend on no product/surface code — only test-only fixtures', () => {
    expect(ALLOWED_DEPENDENCIES.engine).toEqual(['fixtures']);
  });
});
