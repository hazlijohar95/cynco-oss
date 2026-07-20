// Regenerates public/vendor/paper-shaders.js — the committed, self-contained
// ESM bundle the status badges import at runtime. Vendoring keeps the
// deploy build-free while the dependency itself stays under the pnpm
// catalog / lockfile / release-age quarantine. Run via:
//
//   moonx home:bundle-shaders
//
// after bumping @paper-design/shaders in pnpm-workspace.yaml.
import manifest from '@paper-design/shaders/package.json' with { type: 'json' };

const result = await Bun.build({
  entrypoints: [new URL('shaders-entry.ts', import.meta.url).pathname],
  minify: true,
  format: 'esm',
  target: 'browser',
});
const output = result.outputs[0];
// `!== true` rather than `!`: the oxlint program cannot resolve Bun's global
// types here, so `result.success` reads as `any` and a bare negation trips
// strict-boolean-expressions.
if (result.success !== true || output === undefined) {
  console.error(result.logs.join('\n'));
  throw new Error('bundle failed');
}

// Apache-2.0 requires the license notice to travel with redistributed code;
// bun's minifier strips comments, so the banner is prepended after the fact.
const banner = [
  '/*!',
  ` * Paper Shaders v${manifest.version} (@paper-design/shaders)`,
  ' * Copyright Lost Coast Labs, Inc. (https://paper.design)',
  ' * Licensed under Apache-2.0: https://github.com/paper-design/shaders/blob/main/LICENSE',
  ' */',
  '',
].join('\n');

const destination = new URL(
  '../public/vendor/paper-shaders.js',
  import.meta.url
).pathname;
await Bun.write(destination, banner + (await output.text()));
console.log(`wrote ${destination} (${manifest.version})`);
