import { describe, expect, test } from 'bun:test';

import {
  collectExportPaths,
  distTagAddArgs,
  dryRunPublishArgs,
  findManifestDependencyOffenders,
  findQuotedSpecifierOffenders,
  parseArgs,
  PRIVATE_PACKAGES,
  PUBLISH_CONFIGS,
  publishArgs,
  type PublishManifest,
  redactOtp,
  rewritePublishManifest,
} from './publish';

describe('publish CLI flags', () => {
  test('defaults target the beta dist-tag with no OTP and no dry run', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      tag: 'beta',
      promoteLatest: false,
      tagRelease: false,
      releaseBranch: null,
      allowDirty: false,
      otp: null,
    });
  });

  test('accepts inline and separated OTP values', () => {
    expect(parseArgs(['--tag=latest', '--otp=123456'])).toMatchObject({
      otp: '123456',
      tag: 'latest',
    });
    expect(parseArgs(['--otp', '654321'])).toMatchObject({
      otp: '654321',
      tag: 'beta',
    });
  });

  test('rejects missing OTP values', () => {
    expect(() => parseArgs(['--otp'])).toThrow(
      '--otp requires a one-time password'
    );
    expect(() => parseArgs(['--otp='])).toThrow(
      '--otp requires a one-time password'
    );
    expect(() => parseArgs(['--otp', '--tag=beta'])).toThrow(
      '--otp requires a one-time password'
    );
  });

  test('rejects unknown arguments instead of silently ignoring them', () => {
    expect(() => parseArgs(['--promote'])).toThrow('Unknown argument');
  });
});

describe('publish command builders', () => {
  test('publish commands forward OTP without changing release args', () => {
    expect(publishArgs('/tmp/cynco.tgz', 'beta', '123456')).toEqual([
      'publish',
      '/tmp/cynco.tgz',
      '--access',
      'public',
      '--tag',
      'beta',
      '--no-git-checks',
      '--otp',
      '123456',
    ]);
    expect(dryRunPublishArgs('/tmp/cynco.tgz', 'beta', null)).toEqual([
      'publish',
      '/tmp/cynco.tgz',
      '--dry-run',
      '--access',
      'public',
      '--tag',
      'beta',
      '--no-git-checks',
    ]);
    expect(distTagAddArgs('@cynco/accounts', '0.1.0-beta.2', '123456')).toEqual(
      [
        'dist-tag',
        'add',
        '@cynco/accounts@0.1.0-beta.2',
        'latest',
        '--otp',
        '123456',
      ]
    );
  });

  test('OTP values are redacted before commands are logged', () => {
    expect(redactOtp(publishArgs('/tmp/cynco.tgz', 'beta', '123456'))).toEqual([
      'publish',
      '/tmp/cynco.tgz',
      '--access',
      'public',
      '--tag',
      'beta',
      '--no-git-checks',
      '--otp',
      '<redacted>',
    ]);
    expect(redactOtp(['publish', 'package.tgz', '--otp=123456'])).toEqual([
      'publish',
      'package.tgz',
      '--otp=<redacted>',
    ]);
  });
});

describe('rewritePublishManifest', () => {
  const accountsLike: PublishManifest = {
    name: '@cynco/accounts',
    version: '0.1.0-beta.1',
    dependencies: {
      '@cynco/ledger-store': '0.1.0',
      '@cynco/theme': '0.1.0',
    },
    peerDependencies: { react: '^19.0.0' },
    devDependencies: { '@cynco/ledger-test-data': '0.1.0' },
    scripts: { prepublishOnly: 'moon run accounts:prepublish' },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  };

  test('strips inlined deps, lifecycle scripts, and devDependencies', () => {
    const rewritten = rewritePublishManifest(accountsLike, [
      '@cynco/ledger-store',
      '@cynco/theme',
    ]);
    // Both inlined deps removed left dependencies empty, so the field itself
    // must disappear rather than publish an empty object.
    expect(rewritten.dependencies).toBeUndefined();
    expect(rewritten.scripts).toBeUndefined();
    expect(rewritten.devDependencies).toBeUndefined();
    // Consumer-facing fields survive untouched.
    expect(rewritten.peerDependencies).toEqual({ react: '^19.0.0' });
    expect(rewritten.exports).toEqual(accountsLike.exports);
    expect(rewritten.version).toBe('0.1.0-beta.1');
  });

  test('keeps non-inlined runtime dependencies', () => {
    const journalsLike: PublishManifest = {
      name: '@cynco/journals',
      version: '0.1.0-beta.1',
      dependencies: { '@cynco/theme': '0.1.0', lru_map: '0.4.1' },
      scripts: { prepublishOnly: 'moon run journals:prepublish' },
    };
    const rewritten = rewritePublishManifest(journalsLike, []);
    expect(rewritten.dependencies).toEqual({
      '@cynco/theme': '0.1.0',
      lru_map: '0.4.1',
    });
  });

  test('does not mutate the input manifest', () => {
    rewritePublishManifest(accountsLike, ['@cynco/ledger-store']);
    expect(accountsLike.dependencies).toEqual({
      '@cynco/ledger-store': '0.1.0',
      '@cynco/theme': '0.1.0',
    });
    expect(accountsLike.scripts).toEqual({
      prepublishOnly: 'moon run accounts:prepublish',
    });
  });
});

describe('findManifestDependencyOffenders', () => {
  test('flags forbidden packages in every runtime dependency field', () => {
    const manifest: PublishManifest = {
      name: 'x',
      version: '0.0.0',
      dependencies: { '@cynco/ledger-store': '0.1.0' },
      peerDependencies: { '@cynco/ledger-test-data': '0.1.0' },
      optionalDependencies: { '@cynco/theme': '0.1.0' },
    };
    expect(
      findManifestDependencyOffenders(manifest, [
        '@cynco/ledger-store',
        '@cynco/ledger-test-data',
        '@cynco/theme',
      ])
    ).toEqual([
      'dependencies: @cynco/ledger-store',
      'peerDependencies: @cynco/ledger-test-data',
      'optionalDependencies: @cynco/theme',
    ]);
  });

  test('passes a clean manifest and ignores similarly-prefixed names', () => {
    const manifest: PublishManifest = {
      name: '@cynco/theming',
      version: '0.1.0-beta.1',
      dependencies: { '@cynco/theme': '0.1.0' },
    };
    expect(findManifestDependencyOffenders(manifest, PRIVATE_PACKAGES)).toEqual(
      []
    );
    // Forbidding @cynco/theming must not flag the @cynco/theme dependency.
    expect(
      findManifestDependencyOffenders(manifest, ['@cynco/theming'])
    ).toEqual([]);
  });
});

describe('findQuotedSpecifierOffenders', () => {
  test('catches static, dynamic, re-export, and require specifiers', () => {
    const forbidden = ['@cynco/ledger-store'];
    expect(
      findQuotedSpecifierOffenders(
        `import { createStore } from '@cynco/ledger-store';`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-store']);
    expect(
      findQuotedSpecifierOffenders(
        `export * from "@cynco/ledger-store";`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-store']);
    expect(
      findQuotedSpecifierOffenders(
        `const mod = await import('@cynco/ledger-store/internal');`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-store']);
    expect(
      findQuotedSpecifierOffenders(
        `const mod = require("@cynco/ledger-store")`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-store']);
  });

  test('ignores backticked doc-comment mentions', () => {
    // journals' dist d.ts legitimately says "Produced by a data layer (later
    // `@cynco/ledger-store`)" in a doc comment; that must not fail a release.
    expect(
      findQuotedSpecifierOffenders(
        '/** Produced by a data layer (later `@cynco/ledger-store`); */',
        ['@cynco/ledger-store']
      )
    ).toEqual([]);
  });

  test('does not confuse @cynco/theme with @cynco/theming', () => {
    expect(
      findQuotedSpecifierOffenders(`import { x } from '@cynco/theming';`, [
        '@cynco/theme',
      ])
    ).toEqual([]);
    expect(
      findQuotedSpecifierOffenders(`import { x } from '@cynco/theme/roles';`, [
        '@cynco/theme',
      ])
    ).toEqual(['@cynco/theme']);
  });
});

describe('collectExportPaths', () => {
  test('walks string, nested-object, and array export shapes', () => {
    expect(
      collectExportPaths({
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './react': {
          types: './dist/react/index.d.ts',
          import: './dist/react/index.js',
        },
        './style.css': './dist/style.css',
        './fallback': ['./dist/a.js', { default: './dist/b.js' }],
      }).sort()
    ).toEqual([
      './dist/a.js',
      './dist/b.js',
      './dist/index.d.ts',
      './dist/index.js',
      './dist/react/index.d.ts',
      './dist/react/index.js',
      './dist/style.css',
    ]);
  });

  test('ignores bare specifiers and absent exports', () => {
    expect(collectExportPaths(undefined)).toEqual([]);
    // A conditional export can map to another package name; only relative
    // paths are files this package must ship.
    expect(collectExportPaths({ '.': { import: 'some-package' } })).toEqual([]);
  });
});

describe('publish configuration invariants', () => {
  test('accounts is the only package with inlined dependencies, and they match its tsdown noExternal list', () => {
    expect(PUBLISH_CONFIGS['@cynco/accounts']?.inlinedDependencies).toEqual([
      '@cynco/ledger-store',
      '@cynco/theme',
    ]);
    for (const [name, config] of Object.entries(PUBLISH_CONFIGS)) {
      if (name !== '@cynco/accounts') {
        expect(config.inlinedDependencies).toEqual([]);
      }
    }
  });

  test('every private package is covered by the payload scan', () => {
    expect(PRIVATE_PACKAGES).toContain('@cynco/ledger-store');
    expect(PRIVATE_PACKAGES).toContain('@cynco/ledger-test-data');
    // Private packages must never appear in the publishable allowlist.
    for (const name of PRIVATE_PACKAGES) {
      expect(PUBLISH_CONFIGS[name]).toBeUndefined();
    }
  });
});
