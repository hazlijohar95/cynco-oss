import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Direct `pnpm publish` would upload a package.json that still depends on the
// private workspace engine. The release script removes those dependencies
// from the final tarball before publishing.
const pkgPath = resolve(import.meta.dir, '..', 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const inlinedDependencies = ['@cynco/ledger-store', '@cynco/theme'];
const stillPresent = inlinedDependencies.filter(
  (name) => pkg.dependencies?.[name] != null
);

if (stillPresent.length > 0) {
  console.error(
    [
      'Direct publish is disabled for @cynco/accounts.',
      `package.json still depends on ${stillPresent.join(', ')}, which are inlined into dist at build time.`,
      'Use `moonx accounts:publish -- --tag=beta` so the release script can publish the rewritten package.',
    ].join('\n')
  );
  process.exit(1);
}
