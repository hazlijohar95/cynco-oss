import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Direct `pnpm publish` would upload a package.json that still declares the
// private workspace engine as a `workspace:*` dependency. Those deps are
// inlined into dist at build time and stripped from the tarball by the release
// script; a raw publish that skips that rewrite must fail.
//
// Self-contained by design: any `@cynco/*` dependency pinned to a `workspace:`
// range is one the release pipeline inlines and removes, so its presence means
// the manifest has not been rewritten. This needs no shared table and works
// for every publishable package that inlines an engine.
const pkgPath = resolve(import.meta.dir, '..', 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
  name: string;
  dependencies?: Record<string, string>;
};

const workspaceDeps = Object.entries(pkg.dependencies ?? {})
  .filter(
    ([name, range]) =>
      name.startsWith('@cynco/') && range.startsWith('workspace:')
  )
  .map(([name]) => name);

if (workspaceDeps.length > 0) {
  console.error(
    [
      `Direct publish is disabled for ${pkg.name}.`,
      `package.json still declares workspace dependencies ${workspaceDeps.join(', ')}, which are inlined into dist at build time.`,
      `Use the release script (\`moonx <project>:publish -- --tag=beta\`) so the packed manifest is rewritten before anything reaches the registry.`,
    ].join('\n')
  );
  process.exit(1);
}
