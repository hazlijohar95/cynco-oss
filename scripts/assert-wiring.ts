import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRIVATE_PACKAGES, PUBLISH_CONFIGS } from './publish';

// Wiring guard: every hand-maintained "list of packages" in this repo must
// match the actual workspace. Adding a package touches several registries
// that nothing used to cross-check, and both failure modes have already
// happened:
//
//   - @cynco/statements landed without joining the root moon.yml `dependsOn`
//     list or the deploy-docs "Build package dependencies" step, which broke
//     root:lint in CI (type-aware lint resolves @cynco/* through built dists)
//     AND the docs deploy on main (next build could not resolve the package).
//   - @cynco/importers nearly repeated the same miss, and its PUBLISH_CONFIGS
//     entry in scripts/publish.ts was forgotten entirely — the package was
//     tagged publishable but the release pipeline refused to know it.
//
// Each list says (in a comment) what it must contain; this script turns
// those comments into CI failures with the exact line to add.

/**
 * The docs-deploy workflow builds package dists with an explicit
 * `moon run a:build b:build …` line (it cannot rely on `moon ci` affected
 * filtering — it always ships everything). This anchor locates that step.
 */
export const DEPLOY_DOCS_BUILD_STEP = 'Build package dependencies';

export interface WorkspacePackage {
  /** @cynco package name, e.g. "@cynco/statements". */
  name: string;
  /** packages/<dir>; also the moon project name (moon derives ids from dirs). */
  dir: string;
  /** moon.yml tags, e.g. ['tsdown', 'publishable', 'tier-domain']. */
  tags: readonly string[];
  /** `"private": true` in package.json (never published to npm). */
  isPrivate: boolean;
  /**
   * Whether package.json declares `sideEffects` at all. Publishable packages
   * must state it explicitly (true list or false) so consumer bundlers can
   * tree-shake — an absent field silently disables dead-code elimination.
   */
  hasSideEffectsField: boolean;
  /** README.md exists in the package dir (npm renders it; publish requires it). */
  hasReadme: boolean;
  /** LICENSE.md exists in the package dir (publish payload check requires it). */
  hasLicense: boolean;
}

export interface WiringViolation {
  /** Which registry drifted (used to group the report). */
  rule: string;
  /** Actionable message naming the file and the exact entry to add/remove. */
  message: string;
}

/** Extracts the tag list from a moon.yml body, e.g. ['tsdown', 'publishable']. */
export function parseTags(moonYml: string): string[] {
  const match = /tags:\s*\[([^\]]*)\]/.exec(moonYml);
  if (match == null) {
    return [];
  }
  const tags: string[] = [];
  for (const tag of (match[1] ?? '').matchAll(/'([^']+)'/g)) {
    tags.push(tag[1] ?? '');
  }
  return tags;
}

/**
 * Extracts the root moon.yml `dependsOn` list. Line-based rather than a YAML
 * parser: the file is hand-written with a fixed shape (quoted scalars, two
 * spaces of indent), and a parse failure here must not silently return []
 * and green-light a broken list — so the caller treats an empty result as an
 * error.
 */
export function parseDependsOn(rootMoonYml: string): string[] {
  const lines = rootMoonYml.split('\n');
  const start = lines.findIndex((line) => /^dependsOn:\s*$/.test(line));
  if (start === -1) {
    return [];
  }
  const projects: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+'([^']+)'\s*$/.exec(line);
    if (item == null) {
      break; // end of the block (next key, comment, or blank line)
    }
    projects.push(item[1] ?? '');
  }
  return projects;
}

/**
 * Extracts every `<project>:build` target named in the deploy-docs "Build
 * package dependencies" step. The `run:` scalar folds across lines, so this
 * slices from the step anchor to the next step (`- name:`) and collects
 * build targets from the whole slice.
 */
export function parseDeployDocsBuildProjects(deployDocsYml: string): string[] {
  const anchor = deployDocsYml.indexOf(DEPLOY_DOCS_BUILD_STEP);
  if (anchor === -1) {
    return [];
  }
  const rest = deployDocsYml.slice(anchor);
  const nextStep = rest.indexOf('- name:');
  const step = nextStep === -1 ? rest : rest.slice(0, nextStep);
  const projects: string[] = [];
  for (const match of step.matchAll(/([A-Za-z0-9_-]+):build/g)) {
    projects.push(match[1] ?? '');
  }
  return projects;
}

/**
 * Check 1: every dist-producing package (the 'tsdown' tag is what wires the
 * inherited build task) must be in root moon.yml `dependsOn`. The root
 * project's own comment states the contract — type-aware lint resolves
 * @cynco/* imports through built dists, so root:lint silently lints against
 * stale or missing dist for any package left off the list.
 */
export function findMissingDependsOn(
  packages: readonly WorkspacePackage[],
  dependsOn: readonly string[]
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  for (const pkg of packages) {
    if (pkg.tags.includes('tsdown') && !dependsOn.includes(pkg.dir)) {
      violations.push({
        rule: 'root-depends-on',
        message:
          `${pkg.name} builds a dist (tsdown tag in packages/${pkg.dir}/moon.yml) ` +
          `but is missing from root /moon.yml dependsOn — add "- '${pkg.dir}'" ` +
          `or root:lint runs against a missing dist (the @cynco/statements incident).`,
      });
    }
  }
  return violations;
}

/**
 * Check 2 (both directions): every 'publishable'-tagged package must have a
 * PUBLISH_CONFIGS entry, and every PUBLISH_CONFIGS entry must correspond to
 * an existing publishable package (a stale entry would let the release
 * pipeline publish something the workspace no longer sanctions).
 */
export function findPublishConfigViolations(
  packages: readonly WorkspacePackage[],
  configNames: readonly string[]
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  const publishable = packages.filter((p) => p.tags.includes('publishable'));
  for (const pkg of publishable) {
    if (!configNames.includes(pkg.name)) {
      violations.push({
        rule: 'publish-configs',
        message:
          `${pkg.name} is tagged 'publishable' in packages/${pkg.dir}/moon.yml ` +
          `but has no PUBLISH_CONFIGS entry in scripts/publish.ts — add one ` +
          `(project: '${pkg.dir}') or the release pipeline refuses to publish it ` +
          `(the @cynco/importers near-miss).`,
      });
    }
  }
  const publishableNames = new Set(publishable.map((p) => p.name));
  for (const name of configNames) {
    if (!publishableNames.has(name)) {
      violations.push({
        rule: 'publish-configs',
        message:
          `PUBLISH_CONFIGS in scripts/publish.ts lists ${name}, but no workspace ` +
          `package with that name carries the 'publishable' tag — remove the stale ` +
          `entry or tag the package.`,
      });
    }
  }
  return violations;
}

/**
 * Check 3: every @cynco/* workspace package apps/docs depends on must have
 * its `<project>:build` in the deploy-docs build step. That workflow builds
 * an explicit list (no affected-filtering on a full deploy), so a dependency
 * missing from the list breaks the docs deploy on main — exactly how
 * @cynco/statements broke it.
 */
export function findMissingDocsBuilds(
  docsCyncoDependencies: readonly string[],
  builtProjects: readonly string[],
  packagesByName: ReadonlyMap<string, WorkspacePackage>
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  for (const depName of docsCyncoDependencies) {
    const pkg = packagesByName.get(depName);
    if (pkg == null) {
      continue; // external @cynco package; the deploy installs it from npm
    }
    if (!builtProjects.includes(pkg.dir)) {
      violations.push({
        rule: 'deploy-docs-builds',
        message:
          `apps/docs depends on ${depName} but the "${DEPLOY_DOCS_BUILD_STEP}" step ` +
          `in .github/workflows/deploy-docs.yml does not run ${pkg.dir}:build — ` +
          `add it to the \`moon run …\` line or the docs deploy on main breaks.`,
      });
    }
  }
  return violations;
}

/**
 * Check 4: every publishable package must carry the artifacts the publish
 * pipeline requires. README.md and LICENSE.md mirror the exact
 * assertPublishPayload list in scripts/publish.ts (it fails the release if
 * either is missing from the tarball — this guard moves that failure from
 * release time to CI). `sideEffects` is checked here rather than there
 * because it must exist in the *source* manifest: pnpm pack copies it
 * verbatim, and an absent field disables consumer tree-shaking silently.
 */
export function findPublishArtifactViolations(
  packages: readonly WorkspacePackage[]
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  for (const pkg of packages) {
    if (!pkg.tags.includes('publishable')) {
      continue;
    }
    if (!pkg.hasReadme) {
      violations.push({
        rule: 'publish-artifacts',
        message: `${pkg.name} is publishable but packages/${pkg.dir}/README.md is missing — npm renders it and scripts/publish.ts fails the release without it.`,
      });
    }
    if (!pkg.hasLicense) {
      violations.push({
        rule: 'publish-artifacts',
        message: `${pkg.name} is publishable but packages/${pkg.dir}/LICENSE.md is missing — scripts/publish.ts fails the release without it.`,
      });
    }
    if (!pkg.hasSideEffectsField) {
      violations.push({
        rule: 'publish-artifacts',
        message: `${pkg.name} is publishable but packages/${pkg.dir}/package.json has no \`sideEffects\` field — declare it (false, or the CSS-importing entry list) so consumer bundlers can tree-shake.`,
      });
    }
  }
  return violations;
}

/**
 * Check 5: every PUBLISH_CONFIGS `inlinedDependencies` entry must be a real
 * workspace package that is safe to strip from the published manifest:
 * either private (never on npm — consumers COULD NOT resolve it, so inlining
 * is mandatory) or itself publishable (on npm, but deliberately bundled so
 * consumers do not need to install it — @cynco/theme inside accounts and
 * statements). Requiring literal `"private": true` for every entry would
 * false-positive that sanctioned theme inlining; anything neither private
 * nor publishable is a typo or a package the workspace no longer has.
 */
export function findInlinedDependencyViolations(
  configs: ReadonlyMap<string, readonly string[]>,
  packagesByName: ReadonlyMap<string, WorkspacePackage>
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  for (const [name, inlined] of configs) {
    for (const dep of inlined) {
      const pkg = packagesByName.get(dep);
      if (pkg == null) {
        violations.push({
          rule: 'inlined-dependencies',
          message: `PUBLISH_CONFIGS[${name}].inlinedDependencies lists ${dep}, which is not a workspace package under packages/ — fix the name or remove it.`,
        });
        continue;
      }
      if (!pkg.isPrivate && !configs.has(dep)) {
        violations.push({
          rule: 'inlined-dependencies',
          message:
            `PUBLISH_CONFIGS[${name}].inlinedDependencies lists ${dep}, which is ` +
            `neither private nor publishable — an inlined dependency must be ` +
            `\`"private": true\` (never on npm) or a PUBLISH_CONFIGS package ` +
            `(deliberately bundled).`,
        });
      }
    }
  }
  return violations;
}

/**
 * Check 5b: PRIVATE_PACKAGES (the publish pipeline's never-on-npm blocklist)
 * must equal the set of `"private": true` packages under packages/, in both
 * directions. A private package missing from the list can leak into a
 * publish payload unchecked; a stale list entry means the blocklist guards a
 * package that no longer exists (or was made public without updating it).
 */
export function findPrivateRegistryViolations(
  packages: readonly WorkspacePackage[],
  privateList: readonly string[]
): WiringViolation[] {
  const violations: WiringViolation[] = [];
  for (const pkg of packages) {
    if (pkg.isPrivate && !privateList.includes(pkg.name)) {
      violations.push({
        rule: 'private-packages',
        message: `${pkg.name} is "private": true but missing from PRIVATE_PACKAGES in scripts/publish.ts — add it so no publish payload can reference it.`,
      });
    }
  }
  const byName = new Map(packages.map((p) => [p.name, p]));
  for (const name of privateList) {
    const pkg = byName.get(name);
    if (pkg == null) {
      violations.push({
        rule: 'private-packages',
        message: `PRIVATE_PACKAGES in scripts/publish.ts lists ${name}, which is not a workspace package under packages/ — remove the stale entry.`,
      });
    } else if (!pkg.isPrivate) {
      violations.push({
        rule: 'private-packages',
        message: `PRIVATE_PACKAGES in scripts/publish.ts lists ${name}, but packages/${pkg.dir}/package.json is not "private": true — mark it private or remove it from the list.`,
      });
    }
  }
  return violations;
}

/** @cynco/* names across every dependency block of a package.json body. */
export function parseCyncoDependencies(packageJson: string): string[] {
  const manifest = JSON.parse(packageJson) as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const block = manifest[field];
    if (block != null && typeof block === 'object') {
      for (const dep of Object.keys(block as Record<string, unknown>)) {
        if (dep.startsWith('@cynco/')) {
          names.add(dep);
        }
      }
    }
  }
  return [...names];
}

// --- Filesystem driver ------------------------------------------------------

function loadPackages(packagesDir: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = entry.name;
    let moonYml: string;
    let manifestText: string;
    try {
      moonYml = readFileSync(join(packagesDir, dir, 'moon.yml'), 'utf8');
      manifestText = readFileSync(
        join(packagesDir, dir, 'package.json'),
        'utf8'
      );
    } catch {
      continue; // not a full package dir
    }
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    packages.push({
      name: manifest['name'] as string,
      dir,
      tags: parseTags(moonYml),
      isPrivate: manifest['private'] === true,
      hasSideEffectsField: Object.hasOwn(manifest, 'sideEffects'),
      hasReadme: existsSync(join(packagesDir, dir, 'README.md')),
      hasLicense: existsSync(join(packagesDir, dir, 'LICENSE.md')),
    });
  }
  return packages;
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDir, '..');

  const packages = loadPackages(join(root, 'packages'));
  const packagesByName = new Map(packages.map((p) => [p.name, p]));
  const rootMoonYml = readFileSync(join(root, 'moon.yml'), 'utf8');
  const deployDocsYml = readFileSync(
    join(root, '.github', 'workflows', 'deploy-docs.yml'),
    'utf8'
  );
  const docsManifest = readFileSync(
    join(root, 'apps', 'docs', 'package.json'),
    'utf8'
  );

  // Fail loud if a parse anchor rots: an unparseable list must never look
  // like an empty (and therefore trivially satisfied) list.
  const dependsOn = parseDependsOn(rootMoonYml);
  if (dependsOn.length === 0) {
    console.error(
      'assert-wiring: could not parse the dependsOn list from /moon.yml — ' +
        'the guard anchors on a top-level `dependsOn:` block with quoted items.'
    );
    process.exit(1);
  }
  const docsBuilds = parseDeployDocsBuildProjects(deployDocsYml);
  if (docsBuilds.length === 0) {
    console.error(
      `assert-wiring: could not find the "${DEPLOY_DOCS_BUILD_STEP}" step (with ` +
        ':build targets) in .github/workflows/deploy-docs.yml — the guard anchors ' +
        'on that step name.'
    );
    process.exit(1);
  }

  const inlinedByName = new Map(
    Object.entries(PUBLISH_CONFIGS).map(([name, config]) => [
      name,
      config.inlinedDependencies,
    ])
  );

  const violations = [
    ...findMissingDependsOn(packages, dependsOn),
    ...findPublishConfigViolations(packages, Object.keys(PUBLISH_CONFIGS)),
    ...findMissingDocsBuilds(
      parseCyncoDependencies(docsManifest),
      docsBuilds,
      packagesByName
    ),
    ...findPublishArtifactViolations(packages),
    ...findInlinedDependencyViolations(inlinedByName, packagesByName),
    ...findPrivateRegistryViolations(packages, PRIVATE_PACKAGES),
  ];

  if (violations.length > 0) {
    console.error('Wiring violations (a package list drifted from reality):');
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `Wiring OK — ${packages.length} packages; dependsOn, PUBLISH_CONFIGS, ` +
      `deploy-docs builds, publish artifacts, and PRIVATE_PACKAGES all match.`
  );
}

if (import.meta.main) {
  main();
}
