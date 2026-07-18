import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Release script for @cynco/accounts (adapted from Pierre's trees publish
// flow). The published dist inlines @cynco/ledger-store and @cynco/theme via
// tsdown noExternal, but the workspace package.json still declares them as
// dependencies so local resolution works. Publishing that manifest verbatim
// would break `pnpm add @cynco/accounts` (the engine is private and never on
// npm), so this script:
//
//   1. builds and packs the package,
//   2. extracts the tarball and strips the inlined dependencies (and
//      release-only scripts) from its package.json,
//   3. verifies the payload (no workspace refs, no tsbuildinfo),
//   4. repacks and publishes the rewritten tarball.
//
// Flags: --dry-run (default OFF), --tag=<dist-tag> (default beta).

const INLINED_DEPENDENCIES = ['@cynco/ledger-store', '@cynco/theme'];

const packageDir = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagArg = args.find((arg) => arg.startsWith('--tag='));
const tag = tagArg != null ? tagArg.slice('--tag='.length) : 'beta';

function run(command: string, commandArgs: string[], cwd: string): void {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: '' },
  });
  if (result.status !== 0) {
    console.error(`${command} ${commandArgs.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
}

const stage = mkdtempSync(join(tmpdir(), 'cynco-accounts-publish-'));

try {
  // Build (runs the no-ledger-store dist assertion) and pack the workspace
  // manifest as-is.
  run('moon', ['run', 'accounts:build'], packageDir);
  run('pnpm', ['pack', '--out', join(stage, 'raw.tgz')], packageDir);
  run('tar', ['-xzf', 'raw.tgz'], stage);

  const extracted = join(stage, 'package');
  const manifestPath = join(extracted, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  for (const name of INLINED_DEPENDENCIES) {
    if (manifest.dependencies?.[name] != null) {
      delete manifest.dependencies[name];
    }
  }
  if (
    manifest.dependencies != null &&
    Object.keys(manifest.dependencies).length === 0
  ) {
    delete manifest.dependencies;
  }
  // prepublishOnly points at the moon guard chain, which intentionally fails
  // for this package outside this script; the published artifact needs no
  // lifecycle scripts at all.
  delete manifest.scripts;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Verify the payload: no workspace refs anywhere, no incremental-build
  // droppings.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.name.endsWith('.tsbuildinfo')) {
        offenders.push(`${entryPath} (tsbuildinfo)`);
        continue;
      }
      if (/\.(js|d\.ts|json)$/.test(entry.name)) {
        const contents = readFileSync(entryPath, 'utf8');
        if (contents.includes('@cynco/ledger-store')) {
          offenders.push(`${entryPath} (references @cynco/ledger-store)`);
        }
      }
    }
  };
  walk(extracted);
  if (offenders.length > 0) {
    console.error(
      ['Publish payload verification failed:', ...offenders].join('\n')
    );
    process.exit(1);
  }

  run('tar', ['-czf', 'publish.tgz', 'package'], stage);

  const publishArgs = [
    'publish',
    join(stage, 'publish.tgz'),
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
  ];
  if (dryRun) publishArgs.push('--dry-run');
  run('pnpm', publishArgs, packageDir);

  console.log(
    dryRun
      ? 'Dry run complete; nothing was published.'
      : `Published @cynco/accounts@${manifest.version} with tag ${tag}.`
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
