import type { Problem } from '@arethetypeswrong/core';
import { describe, expect, test } from 'bun:test';
import type { Message as PublintMessage } from 'publint';

import {
  collectExportPaths,
  describeAttwProblem,
  distTagAddArgs,
  dryRunPublishArgs,
  ESM_ONLY_ATTW_ALLOWLIST,
  evaluateAttwProblems,
  findManifestDependencyOffenders,
  findQuotedSpecifierOffenders,
  parseArgs,
  partitionPublintMessages,
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
      '@cynco/ledger-core': '0.1.0',
      '@cynco/theme': '0.1.0',
    },
    peerDependencies: { react: '^19.0.0' },
    devDependencies: { '@cynco/ledger-test-data': '0.1.0' },
    scripts: { prepublishOnly: 'moon run accounts:prepublish' },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  };

  test('strips lifecycle scripts and devDependencies', () => {
    const rewritten = rewritePublishManifest(accountsLike);
    expect(rewritten.scripts).toBeUndefined();
    expect(rewritten.devDependencies).toBeUndefined();
    // Consumer-facing fields survive untouched — runtime dependencies ship
    // exactly as declared (every workspace dep is on npm).
    expect(rewritten.dependencies).toEqual({
      '@cynco/ledger-core': '0.1.0',
      '@cynco/theme': '0.1.0',
    });
    expect(rewritten.peerDependencies).toEqual({ react: '^19.0.0' });
    expect(rewritten.exports).toEqual(accountsLike.exports);
    expect(rewritten.version).toBe('0.1.0-beta.1');
  });

  test('does not mutate the input manifest', () => {
    rewritePublishManifest(accountsLike);
    expect(accountsLike.devDependencies).toEqual({
      '@cynco/ledger-test-data': '0.1.0',
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
      dependencies: { '@cynco/ledger-core': '0.1.0' },
      peerDependencies: { '@cynco/ledger-test-data': '0.1.0' },
      optionalDependencies: { '@cynco/theme': '0.1.0' },
    };
    expect(
      findManifestDependencyOffenders(manifest, [
        '@cynco/ledger-core',
        '@cynco/ledger-test-data',
        '@cynco/theme',
      ])
    ).toEqual([
      'dependencies: @cynco/ledger-core',
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
    const forbidden = ['@cynco/ledger-core'];
    expect(
      findQuotedSpecifierOffenders(
        `import { createStore } from '@cynco/ledger-core';`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-core']);
    expect(
      findQuotedSpecifierOffenders(
        `export * from "@cynco/ledger-core";`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-core']);
    expect(
      findQuotedSpecifierOffenders(
        `const mod = await import('@cynco/ledger-core/internal');`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-core']);
    expect(
      findQuotedSpecifierOffenders(
        `const mod = require("@cynco/ledger-core")`,
        forbidden
      )
    ).toEqual(['@cynco/ledger-core']);
  });

  test('ignores backticked doc-comment mentions', () => {
    // journals' dist d.ts legitimately says "Produced by a data layer (later
    // `@cynco/ledger-core`)" in a doc comment; that must not fail a release.
    expect(
      findQuotedSpecifierOffenders(
        '/** Produced by a data layer (later `@cynco/ledger-core`); */',
        ['@cynco/ledger-core']
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

describe('partitionPublintMessages', () => {
  const message = (
    type: PublintMessage['type'],
    code: string
  ): PublintMessage =>
    // Synthetic fixture: the union's common shape is all the partitioning
    // logic reads, so a representative code with empty args is enough.
    ({ code, args: {}, path: ['exports', '.'], type }) as PublintMessage;

  test('errors block, warnings pass through, suggestions are dropped', () => {
    const { errors, warnings } = partitionPublintMessages([
      message('error', 'FILE_DOES_NOT_EXIST'),
      message('warning', 'USE_TYPE'),
      message('suggestion', 'USE_FILES'),
      message('error', 'EXPORTS_VALUE_INVALID'),
    ]);
    expect(errors.map((entry) => entry.code)).toEqual([
      'FILE_DOES_NOT_EXIST',
      'EXPORTS_VALUE_INVALID',
    ]);
    expect(warnings.map((entry) => entry.code)).toEqual(['USE_TYPE']);
  });

  test('a clean payload produces an empty verdict', () => {
    expect(partitionPublintMessages([])).toEqual({ errors: [], warnings: [] });
  });
});

describe('evaluateAttwProblems', () => {
  const esmOnlyManifest: PublishManifest = {
    name: '@cynco/theme',
    version: '0.1.0',
    type: 'module',
  };
  const cjsResolvesToEsm: Problem = {
    kind: 'CJSResolvesToESM',
    entrypoint: '.',
    resolutionKind: 'node16-cjs',
  };
  const node10NoResolution: Problem = {
    kind: 'NoResolution',
    entrypoint: '.',
    resolutionKind: 'node10',
  };
  const missingNamedExports: Problem = {
    kind: 'NamedExports',
    typesFileName: 'dist/index.d.ts',
    implementationFileName: 'dist/index.js',
    isMissingAllNamed: false,
    missing: ['parseCsv'],
  };

  test('allowlists the inherent ESM-only problems for "type": "module" packages', () => {
    const verdict = evaluateAttwProblems(
      [cjsResolvesToEsm, node10NoResolution],
      esmOnlyManifest
    );
    expect(verdict.failures).toEqual([]);
    expect(verdict.allowed.map((entry) => entry.problem.kind)).toEqual([
      'CJSResolvesToESM',
      'NoResolution',
    ]);
    // Every allowlisted hit must carry its justification into the logs.
    for (const entry of verdict.allowed) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  test('fails on real resolution problems even for ESM-only packages', () => {
    const esmNoResolution: Problem = {
      kind: 'NoResolution',
      entrypoint: './react',
      resolutionKind: 'node16-esm',
    };
    const verdict = evaluateAttwProblems(
      [missingNamedExports, esmNoResolution, cjsResolvesToEsm],
      esmOnlyManifest
    );
    expect(verdict.failures.map((entry) => entry.kind)).toEqual([
      'NamedExports',
      'NoResolution',
    ]);
    expect(verdict.allowed.map((entry) => entry.problem.kind)).toEqual([
      'CJSResolvesToESM',
    ]);
  });

  test('grants zero exemptions to packages that are not ESM-only', () => {
    const dualFormatManifest: PublishManifest = {
      name: '@cynco/hypothetical-dual',
      version: '0.1.0',
    };
    const verdict = evaluateAttwProblems(
      [cjsResolvesToEsm, node10NoResolution],
      dualFormatManifest
    );
    expect(verdict.failures).toHaveLength(2);
    expect(verdict.allowed).toEqual([]);
  });

  test('allowlist rules pin both kind and resolutionKind', () => {
    // Guards against a rule accidentally widening: NoResolution is only
    // acceptable in node10 mode, CJSResolvesToESM only in node16-cjs.
    expect(
      ESM_ONLY_ATTW_ALLOWLIST.map((rule) => [rule.kind, rule.resolutionKind])
    ).toEqual([
      ['CJSResolvesToESM', 'node16-cjs'],
      ['NoResolution', 'node10'],
    ]);
  });
});

describe('describeAttwProblem', () => {
  test('names entrypoint and resolution mode for resolution problems', () => {
    expect(
      describeAttwProblem({
        kind: 'NoResolution',
        entrypoint: '.',
        resolutionKind: 'node10',
      })
    ).toBe('NoResolution — entrypoint "." (node10)');
  });

  test('names the type/implementation file pair for mismatch problems', () => {
    expect(
      describeAttwProblem({
        kind: 'NamedExports',
        typesFileName: 'dist/index.d.ts',
        implementationFileName: 'dist/index.js',
        isMissingAllNamed: false,
        missing: ['parseCsv'],
      })
    ).toBe('NamedExports — types dist/index.d.ts vs impl dist/index.js');
  });
});

describe('publish configuration invariants', () => {
  test('the engine is publishable — nothing is inlined anymore', () => {
    expect(PUBLISH_CONFIGS['@cynco/ledger-core']).toEqual({
      project: 'ledger-core',
    });
  });

  test('every private package is covered by the payload scan', () => {
    expect(PRIVATE_PACKAGES).toEqual(['@cynco/ledger-test-data']);
    // Private packages must never appear in the publishable allowlist.
    for (const name of PRIVATE_PACKAGES) {
      expect(PUBLISH_CONFIGS[name]).toBeUndefined();
    }
  });
});
