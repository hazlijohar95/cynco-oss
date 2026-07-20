import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tiered-architecture boundary guard. The accounting platform is layered so
// that dependencies only ever point DOWNWARD; this script fails CI the moment
// a package imports across a forbidden edge, so the layering survives as the
// suite grows to reporting, invoicing, agents, and beyond.
//
// Tiers (highest to lowest):
//
//   domain    product APIs (accounts, journals; future reports, invoices…)
//   surface   shared visual/runtime foundation (theme, theming)
//   engine    pure data/math cores (ledger-core; future reporting-core…)
//   fixtures  deterministic test data (ledger-test-data)
//
// A package declares its tier with a `tier-<name>` tag in its moon.yml. The
// matrix below is the whole contract: an entry lists the tiers a given tier
// MAY depend on. Anything else is a violation.

export type Tier = 'domain' | 'surface' | 'engine' | 'fixtures';

// What each tier is allowed to depend on (workspace @cynco/* deps only).
// - domain builds on engines + surface (the product layer wires it together)
//   and may pull fixtures in dev/test for demos and benchmarks.
// - surface is foundational: depends on nothing internal except other surface
//   (theming builds on theme).
// - engine is pure: no internal deps at all — this is what keeps the money and
//   balancing kernels testable in isolation and free of UI/theme weight.
// - fixtures generate data for engines, so they may read an engine's types.
//
// `fixtures` is allowed from every tier because that data is test-only and
// never ships (it is a private package the publish guard blocks from any
// payload); depending on it cannot pollute a shipped artifact.
export const ALLOWED_DEPENDENCIES: Record<Tier, readonly Tier[]> = {
  domain: ['engine', 'surface', 'fixtures'],
  surface: ['surface', 'fixtures'],
  engine: ['fixtures'],
  fixtures: ['engine'],
};

export interface PackageTier {
  /** @cynco package name, e.g. "@cynco/accounts". */
  name: string;
  /** Workspace directory name, e.g. "accounts". */
  dir: string;
  tier: Tier;
  /** @cynco/* workspace dependencies declared in package.json. */
  cyncoDependencies: readonly string[];
}

export interface TierViolation {
  from: string;
  to: string;
  fromTier: Tier;
  toTier: Tier;
}

const TIER_TAG = /tier-(domain|surface|engine|fixtures)/;

/** Extracts the declared tier from a moon.yml body, or null if none is tagged. */
export function parseTier(moonYml: string): Tier | null {
  const match = TIER_TAG.exec(moonYml);
  return match == null ? null : (match[1] as Tier);
}

/**
 * Extracts the @cynco/* dependencies from a package.json body. Reads every
 * dependency block (deps, dev, peer, optional) because a forbidden edge is a
 * violation no matter which block declares it.
 */
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

/**
 * Given the resolved tier of every package, returns every dependency edge that
 * violates the allowed-direction matrix. Pure over its inputs so the unit test
 * can pin the matrix without touching the filesystem.
 */
export function findTierViolations(
  packages: readonly PackageTier[]
): TierViolation[] {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const violations: TierViolation[] = [];
  for (const pkg of packages) {
    const allowed = ALLOWED_DEPENDENCIES[pkg.tier];
    for (const depName of pkg.cyncoDependencies) {
      const dep = byName.get(depName);
      if (dep == null) {
        continue; // external @cynco package (e.g. @cynco/icons); not tiered here
      }
      if (!allowed.includes(dep.tier)) {
        violations.push({
          from: pkg.name,
          to: dep.name,
          fromTier: pkg.tier,
          toTier: dep.tier,
        });
      }
    }
  }
  return violations;
}

// --- Filesystem driver ------------------------------------------------------

function loadPackages(packagesDir: string): PackageTier[] {
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const packages: PackageTier[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = entry.name;
    const moonPath = join(packagesDir, dir, 'moon.yml');
    const manifestPath = join(packagesDir, dir, 'package.json');
    let moonYml: string;
    let manifest: string;
    try {
      moonYml = readFileSync(moonPath, 'utf8');
      manifest = readFileSync(manifestPath, 'utf8');
    } catch {
      continue; // not a full package dir
    }
    const tier = parseTier(moonYml);
    if (tier == null) {
      throw new Error(
        `packages/${dir}/moon.yml is missing a tier tag ` +
          `(tier-domain | tier-surface | tier-engine | tier-fixtures). ` +
          `Every package must declare its architectural tier.`
      );
    }
    const name = (JSON.parse(manifest) as { name: string }).name;
    packages.push({
      name,
      dir,
      tier,
      cyncoDependencies: parseCyncoDependencies(manifest),
    });
  }
  return packages;
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const packagesDir = resolve(scriptDir, '..', 'packages');
  const packages = loadPackages(packagesDir);
  const violations = findTierViolations(packages);

  if (violations.length > 0) {
    console.error('Tier boundary violations (dependencies must point down):');
    for (const v of violations) {
      const allowed = ALLOWED_DEPENDENCIES[v.fromTier];
      const allowedText =
        allowed.length > 0 ? allowed.join(', ') : '(nothing internal)';
      console.error(
        `  ${v.from} (${v.fromTier}) → ${v.to} (${v.toTier}) ` +
          `— ${v.fromTier} may depend on: ${allowedText}`
      );
    }
    process.exit(1);
  }

  console.log(
    `Tier boundaries OK — ${packages.length} packages, ` +
      `every @cynco dependency points downward.`
  );
}

if (import.meta.main) {
  main();
}
