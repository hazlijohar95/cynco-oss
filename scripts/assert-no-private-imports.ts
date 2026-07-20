import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { PRIVATE_PACKAGES, PUBLISH_CONFIGS } from './publish';

// Post-build leak guard for any publishable package that inlines a private
// engine. Runs from a package directory (moon sets cwd) and derives the
// forbidden import list from the shared release table in publish.ts:
//
//   forbidden = the package's own inlinedDependencies  +  PRIVATE_PACKAGES
//
// so a new engine/UI pair is protected the moment its PUBLISH_CONFIGS entry
// exists — no per-package guard script to copy. The engine source is bundled
// into dist via tsdown noExternal; this asserts it never survives as a runtime
// or type import string that a consumer's resolver would try to fetch.
//
// Sourcemaps (.map) are excluded: they embed pre-bundling source text
// (including the original import specifiers) that nothing resolves at runtime.

const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.d.mts',
  '.d.cts',
]);

interface CliArgs {
  dir: string;
  scanAllTextFiles: boolean;
}

function isCodeFile(name: string): boolean {
  for (const extension of CODE_EXTENSIONS) {
    if (name.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function shouldScanFile(name: string, scanAllTextFiles: boolean): boolean {
  if (name.endsWith('.map')) {
    return false;
  }
  return scanAllTextFiles || isCodeFile(name);
}

async function collectFiles(
  dir: string,
  scanAllTextFiles: boolean
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, scanAllTextFiles)));
    } else if (entry.isFile() && shouldScanFile(entry.name, scanAllTextFiles)) {
      files.push(full);
    }
  }
  return files;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let dir = 'dist';
  let scanAllTextFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      const next = argv[index + 1];
      if (next == null) {
        throw new Error('--dir requires a path argument');
      }
      dir = next;
      index += 1;
    } else if (arg === '--all-text-files') {
      scanAllTextFiles = true;
    }
  }
  return { dir, scanAllTextFiles };
}

// Every private package specifier that must not appear in this package's
// payload: its own inlined deps plus the repo-wide private set. A quoted
// boundary (`'`, `"`, or `/`) prevents "@cynco/theme" matching "@cynco/theming".
export function forbiddenSpecifiers(packageName: string): string[] {
  const config = PUBLISH_CONFIGS[packageName];
  const inlined = config?.inlinedDependencies ?? [];
  return [...new Set([...inlined, ...PRIVATE_PACKAGES])];
}

async function main(): Promise<void> {
  const { dir, scanAllTextFiles } = parseArgs(process.argv.slice(2));
  const packageDir = process.cwd();
  const manifest = JSON.parse(
    await readFile(join(packageDir, 'package.json'), 'utf8')
  ) as { name: string };
  const forbidden = forbiddenSpecifiers(manifest.name);

  // Nothing private is inlined into this package — the guard is a no-op, which
  // is correct for a package that bundles no engine.
  if (forbidden.length === 0) {
    return;
  }

  const absDir = resolve(packageDir, dir);
  const files = await collectFiles(absDir, scanAllTextFiles);
  const offenders: string[] = [];
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    for (const name of forbidden) {
      // Match quoted/subpath specifiers, not bare substrings, so a doc comment
      // mentioning the name in prose does not trip the guard.
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`['"]${escaped}(?:/[^'"]*)?['"]`);
      if (pattern.test(contents)) {
        offenders.push(`${relative(packageDir, file)} (imports ${name})`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error(
      `assert-no-private-imports: ${offenders.length} leak(s) of a private ` +
        `package under ${dir} in ${manifest.name}:`
    );
    for (const offender of offenders) {
      console.error(`  ${offender}`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
