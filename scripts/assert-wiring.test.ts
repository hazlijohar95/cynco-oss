import { describe, expect, test } from 'bun:test';

import {
  findMissingDependsOn,
  findMissingDocsBuilds,
  findPrivateRegistryViolations,
  findPublishArtifactViolations,
  findPublishConfigViolations,
  parseCyncoDependencies,
  parseDependsOn,
  parseDeployDocsBuildProjects,
  parseTags,
  type WorkspacePackage,
} from './assert-wiring';

const pkg = (
  name: string,
  dir: string,
  overrides: Partial<WorkspacePackage> = {}
): WorkspacePackage => ({
  name,
  dir,
  tags: ['tsdown', 'publishable', 'tier-domain'],
  isPrivate: false,
  hasSideEffectsField: true,
  hasReadme: true,
  hasLicense: true,
  ...overrides,
});

describe('parseTags', () => {
  test('reads the quoted tag list from a moon.yml body', () => {
    expect(parseTags("tags: ['tsdown', 'publishable', 'tier-domain']")).toEqual(
      ['tsdown', 'publishable', 'tier-domain']
    );
  });

  test('returns [] when no tags line exists', () => {
    expect(parseTags("language: 'typescript'")).toEqual([]);
  });
});

describe('parseDependsOn', () => {
  test('reads the quoted list items after the dependsOn key', () => {
    const yml = [
      "language: 'typescript'",
      'dependsOn:',
      "  - 'theme'",
      "  - 'ledger-core'",
      '',
      'tasks:',
    ].join('\n');
    expect(parseDependsOn(yml)).toEqual(['theme', 'ledger-core']);
  });

  test('stops at the end of the block and returns [] without the key', () => {
    expect(parseDependsOn("tasks:\n  test:\n    command: 'x'")).toEqual([]);
  });
});

describe('parseDeployDocsBuildProjects', () => {
  test('collects :build targets from the folded run scalar', () => {
    const yml = [
      '      - name: Build package dependencies',
      '        run:',
      '          moon run journals:build accounts:build theme:build',
      '          ledger-test-data:build statements:build',
      '',
      '      - name: Generate llms.txt',
      '        run: moon run docs:generate-llms-txt',
    ].join('\n');
    expect(parseDeployDocsBuildProjects(yml)).toEqual([
      'journals',
      'accounts',
      'theme',
      'ledger-test-data',
      'statements',
    ]);
  });

  test('does not read :build targets from later steps', () => {
    const yml = [
      '      - name: Build package dependencies',
      '        run: moon run theme:build',
      '      - name: Other',
      '        run: moon run demo:build',
    ].join('\n');
    expect(parseDeployDocsBuildProjects(yml)).toEqual(['theme']);
  });

  test('returns [] when the anchor step is absent', () => {
    expect(parseDeployDocsBuildProjects('- name: Deploy\n  run: x')).toEqual(
      []
    );
  });
});

describe('parseCyncoDependencies', () => {
  test('collects @cynco deps across dependency blocks, ignoring others', () => {
    const manifest = JSON.stringify({
      dependencies: { '@cynco/journals': 'workspace:*', react: '19' },
      devDependencies: { '@cynco/theme': 'workspace:*' },
    });
    expect(parseCyncoDependencies(manifest).sort()).toEqual([
      '@cynco/journals',
      '@cynco/theme',
    ]);
  });
});

describe('findMissingDependsOn', () => {
  test('flags a tsdown package absent from the root list', () => {
    const packages = [
      pkg('@cynco/theme', 'theme'),
      pkg('@cynco/statements', 'statements'),
    ];
    const violations = findMissingDependsOn(packages, ['theme']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('@cynco/statements');
    expect(violations[0]?.message).toContain("- 'statements'");
  });

  test('ignores packages without the tsdown tag', () => {
    const packages = [
      pkg('@cynco/fixtures-only', 'fixtures-only', {
        tags: ['tier-fixtures'],
      }),
    ];
    expect(findMissingDependsOn(packages, [])).toEqual([]);
  });
});

describe('findPublishConfigViolations', () => {
  test('flags a publishable package with no PUBLISH_CONFIGS entry', () => {
    const packages = [pkg('@cynco/importers', 'importers')];
    const violations = findPublishConfigViolations(packages, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('@cynco/importers');
    expect(violations[0]?.message).toContain('PUBLISH_CONFIGS');
  });

  test('flags a stale PUBLISH_CONFIGS entry with no publishable package', () => {
    const violations = findPublishConfigViolations([], ['@cynco/removed']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('@cynco/removed');
  });

  test('accepts a matched pair', () => {
    const packages = [pkg('@cynco/theme', 'theme')];
    expect(findPublishConfigViolations(packages, ['@cynco/theme'])).toEqual([]);
  });
});

describe('findMissingDocsBuilds', () => {
  const byName = new Map([
    ['@cynco/journals', pkg('@cynco/journals', 'journals')],
    ['@cynco/theme', pkg('@cynco/theme', 'theme')],
  ]);

  test('flags a docs dependency whose project is not built', () => {
    const violations = findMissingDocsBuilds(
      ['@cynco/journals', '@cynco/theme'],
      ['journals'],
      byName
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('theme:build');
  });

  test('ignores non-workspace @cynco deps (installed from npm)', () => {
    expect(findMissingDocsBuilds(['@cynco/icons'], [], byName)).toEqual([]);
  });
});

describe('findPublishArtifactViolations', () => {
  test('flags missing README, LICENSE, and sideEffects independently', () => {
    const packages = [
      pkg('@cynco/bare', 'bare', {
        hasReadme: false,
        hasLicense: false,
        hasSideEffectsField: false,
      }),
    ];
    const violations = findPublishArtifactViolations(packages);
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.message).join('\n')).toContain('README.md');
    expect(violations.map((v) => v.message).join('\n')).toContain('LICENSE.md');
    expect(violations.map((v) => v.message).join('\n')).toContain(
      'sideEffects'
    );
  });

  test('ignores non-publishable packages entirely', () => {
    const packages = [
      pkg('@cynco/ledger-core', 'ledger-core', {
        tags: ['tsdown', 'tier-engine'],
        hasReadme: false,
        hasLicense: false,
        hasSideEffectsField: false,
      }),
    ];
    expect(findPublishArtifactViolations(packages)).toEqual([]);
  });
});

describe('findPrivateRegistryViolations', () => {
  test('flags a private package missing from PRIVATE_PACKAGES', () => {
    const packages = [
      pkg('@cynco/ledger-core', 'ledger-core', { isPrivate: true }),
    ];
    const violations = findPrivateRegistryViolations(packages, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('PRIVATE_PACKAGES');
  });

  test('flags stale and mis-marked PRIVATE_PACKAGES entries', () => {
    const packages = [pkg('@cynco/theme', 'theme', { isPrivate: false })];
    const violations = findPrivateRegistryViolations(packages, [
      '@cynco/theme',
      '@cynco/removed',
    ]);
    expect(violations).toHaveLength(2);
  });

  test('accepts a matched registry', () => {
    const packages = [
      pkg('@cynco/ledger-core', 'ledger-core', { isPrivate: true }),
      pkg('@cynco/theme', 'theme'),
    ];
    expect(
      findPrivateRegistryViolations(packages, ['@cynco/ledger-core'])
    ).toEqual([]);
  });
});
