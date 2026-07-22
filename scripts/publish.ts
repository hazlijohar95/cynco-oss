import {
  checkPackage,
  createPackageFromTarballData,
  type Problem,
  type ResolutionKind,
} from '@arethetypeswrong/core';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { publint, type Message as PublintMessage } from 'publint';
import { formatMessage } from 'publint/utils';

// Shared release pipeline for every published @cynco package. Invoked per
// package through the inherited `publish` moon task, which runs with the
// package directory as cwd:
//
//   moonx theme:publish -- --dry-run
//   moonx accounts:publish -- --tag=beta
//   moonx journals:publish -- --tag=latest --promote-latest --tag-release
//
// The load-bearing step is repacking the pnpm tarball after rewriting its
// package.json, so the tarball we rehearse with --dry-run is byte-for-byte
// the tarball we publish. Rewriting drops release-only fields (scripts,
// devDependencies) that must never reach consumers — devDependencies in
// particular still names private workspace packages.

// ---------------------------------------------------------------------------
// Per-package release configuration
// ---------------------------------------------------------------------------

export interface PackagePublishConfig {
  /** moon project name, i.e. the packages/<dir> folder name. */
  project: string;
}

/**
 * Workspace packages that are never published to npm. No published payload
 * may import them and no published manifest may depend on them, in any
 * package.
 */
export const PRIVATE_PACKAGES: readonly string[] = ['@cynco/ledger-test-data'];

/**
 * The allowlist of publishable packages. A static table keeps the release
 * surface reviewable in one place: publishing a new package requires
 * touching this file, which the publish tests cover.
 */
export const PUBLISH_CONFIGS: Record<string, PackagePublishConfig> = {
  '@cynco/accounts': { project: 'accounts' },
  '@cynco/importers': { project: 'importers' },
  '@cynco/journals': { project: 'journals' },
  '@cynco/ledger-core': { project: 'ledger-core' },
  '@cynco/statements': { project: 'statements' },
  '@cynco/theme': { project: 'theme' },
  '@cynco/theming': { project: 'theming' },
};

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

export interface CliFlags {
  dryRun: boolean;
  tag: string;
  promoteLatest: boolean;
  tagRelease: boolean;
  releaseBranch: string | null;
  allowDirty: boolean;
  otp: string | null;
}

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    tag: 'beta',
    promoteLatest: false,
    tagRelease: false,
    releaseBranch: null,
    allowDirty: false,
    otp: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--promote-latest') {
      flags.promoteLatest = true;
    } else if (arg === '--tag-release') {
      flags.tagRelease = true;
    } else if (arg === '--dirty') {
      flags.allowDirty = true;
    } else if (arg.startsWith('--tag=')) {
      flags.tag = arg.slice('--tag='.length);
    } else if (arg === '--otp') {
      const otp = argv[index + 1];
      if (otp === undefined || otp.length === 0 || otp.startsWith('--')) {
        throw new Error('--otp requires a one-time password');
      }
      flags.otp = otp;
      index += 1;
    } else if (arg.startsWith('--otp=')) {
      const otp = arg.slice('--otp='.length);
      if (otp.length === 0) {
        throw new Error('--otp requires a one-time password');
      }
      flags.otp = otp;
    } else if (arg.startsWith('--release-branch=')) {
      flags.releaseBranch = arg.slice('--release-branch='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// pnpm command builders (pure, so tests can pin the exact release commands)
// ---------------------------------------------------------------------------

// OTP goes last so auth details stay isolated from the rest of the release
// command and can be redacted consistently in logs.
function withOtp(args: string[], otp: string | null): string[] {
  if (otp === null) {
    return args;
  }
  return [...args, '--otp', otp];
}

export function publishArgs(
  tarballPath: string,
  tag: string,
  otp: string | null
): string[] {
  // --access public: @cynco/* are scoped packages, which npm publishes as
  // private by default; --no-git-checks: the tarball is published from a
  // tempdir, not the git worktree (cleanliness is enforced by preflight).
  return withOtp(
    [
      'publish',
      tarballPath,
      '--access',
      'public',
      '--tag',
      tag,
      '--no-git-checks',
    ],
    otp
  );
}

export function dryRunPublishArgs(
  tarballPath: string,
  tag: string,
  otp: string | null
): string[] {
  return withOtp(
    [
      'publish',
      tarballPath,
      '--dry-run',
      '--access',
      'public',
      '--tag',
      tag,
      '--no-git-checks',
    ],
    otp
  );
}

export function distTagAddArgs(
  packageName: string,
  version: string,
  otp: string | null
): string[] {
  return withOtp(
    ['dist-tag', 'add', `${packageName}@${version}`, 'latest'],
    otp
  );
}

/**
 * OTP values are one-time but still secrets while valid; every command line
 * this script logs must pass through here first.
 */
export function redactOtp(args: readonly string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      redacted.push('<redacted>');
      redactNext = false;
      continue;
    }
    if (arg === '--otp') {
      redacted.push(arg);
      redactNext = true;
      continue;
    }
    if (arg.startsWith('--otp=')) {
      redacted.push('--otp=<redacted>');
      continue;
    }
    redacted.push(arg);
  }

  return redacted;
}

// ---------------------------------------------------------------------------
// Manifest rewriting and payload verification (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface PublishManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: unknown;
  [key: string]: unknown;
}

/**
 * Produces the manifest that actually ships to npm. Returns a new object —
 * the caller keeps the original for the dry-run diff.
 *
 * - `scripts` is dropped entirely: the only script is prepublishOnly, which
 *   points at the moon guard chain — meaningless inside the packed artifact.
 * - `devDependencies` is dropped: npm ignores it on install, but it still
 *   names private workspace packages (accounts dev-depends on
 *   @cynco/ledger-test-data), and the published manifest must not mention
 *   private packages anywhere.
 */
export function rewritePublishManifest(
  manifest: PublishManifest
): PublishManifest {
  const rewritten: PublishManifest = structuredClone(manifest);
  delete rewritten.scripts;
  delete rewritten.devDependencies;
  return rewritten;
}

/**
 * Runtime dependency fields the npm client resolves on install. devDependencies
 * is intentionally absent: it never reaches consumers and is stripped by
 * rewritePublishManifest anyway.
 */
const RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Names any forbidden package still reachable through the manifest's runtime
 * dependency fields. Field-level (not substring) matching avoids the
 * "@cynco/theme is a prefix of @cynco/theming" trap.
 */
export function findManifestDependencyOffenders(
  manifest: PublishManifest,
  forbiddenPackages: readonly string[]
): string[] {
  const offenders: string[] = [];
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (block == null) {
      continue;
    }
    for (const name of Object.keys(block)) {
      if (forbiddenPackages.includes(name)) {
        offenders.push(`${field}: ${name}`);
      }
    }
  }
  return offenders;
}

/**
 * Finds quoted module specifiers of forbidden packages (bare or subpath) in a
 * source text. Matching quoted specifiers instead of raw substrings is
 * deliberate: journals' d.ts output legitimately mentions
 * `@cynco/ledger-core` in a backticked doc comment, which resolves nothing
 * at runtime — but any *quoted* occurrence is either an import/require/
 * dynamic-import specifier or close enough to one to fail the release. The
 * trailing boundary (quote or `/`) keeps `@cynco/theme` from matching
 * `@cynco/theming`.
 */
export function findQuotedSpecifierOffenders(
  source: string,
  forbiddenPackages: readonly string[]
): string[] {
  const offenders: string[] = [];
  for (const name of forbiddenPackages) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`['"]${escaped}(?:/[^'"]*)?['"]`);
    if (pattern.test(source)) {
      offenders.push(name);
    }
  }
  return offenders;
}

/**
 * Collects every relative file path referenced by the `exports` map (string
 * shorthand, nested condition objects, and arrays). The driver asserts each
 * one exists inside the payload so a stale `exports` entry can never ship
 * pointing at a dist file the build no longer emits.
 */
export function collectExportPaths(exportsField: unknown): string[] {
  const paths = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (node.startsWith('./')) {
        paths.add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const value of Object.values(node)) {
        visit(value);
      }
    }
  };
  visit(exportsField);
  return [...paths];
}

// ---------------------------------------------------------------------------
// Consumer-correctness verdicts (pure, unit-tested)
//
// assertPublishPayload proves the payload contains what it claims; nothing
// above this line proves a *consumer* can actually resolve it. A broken
// exports condition order, a missing/mislinked types file, an ESM/CJS
// mismatch, or a d.ts that references a private package would all sail
// through the file-existence checks and ship silently. publint lints the
// manifest/payload pairing; arethetypeswrong resolves every entrypoint the
// way real TypeScript consumers do (node10 / node16-cjs / node16-esm /
// bundler). Both run against the final artifact, and both run during
// --dry-run — they are verification, not upload.
// ---------------------------------------------------------------------------

/**
 * Splits publint messages into release-blocking errors and printed-only
 * warnings. Threshold rationale:
 * - `error`: the package is broken for some consumer (missing file, wrong
 *   format, invalid exports value) — always fails the release.
 * - `warning`: works today but is fragile or deoptimized in some tooling —
 *   printed so a maintainer sees it in every dry-run, but does not block
 *   (blocking would make unrelated releases hostage to hygiene nits).
 * - `suggestion`: pure style advice — noise at release time; the publint
 *   call filters these out with `level: 'warning'` so they never reach here.
 */
export function partitionPublintMessages(messages: readonly PublintMessage[]): {
  errors: PublintMessage[];
  warnings: PublintMessage[];
} {
  const errors: PublintMessage[] = [];
  const warnings: PublintMessage[] = [];
  for (const message of messages) {
    if (message.type === 'error') {
      errors.push(message);
    } else if (message.type === 'warning') {
      warnings.push(message);
    }
  }
  return { errors, warnings };
}

export interface AttwAllowRule {
  kind: Problem['kind'];
  resolutionKind: ResolutionKind;
  /** Why this problem is acceptable — printed next to every allowlisted hit. */
  reason: string;
}

/**
 * attw problems that are inherent consequences of shipping ESM-only packages
 * ("type": "module", import-only exports) rather than packaging defects. The
 * allowlist only applies when the shipped manifest really is ESM-only; a
 * future dual-format package gets zero exemptions.
 */
export const ESM_ONLY_ATTW_ALLOWLIST: readonly AttwAllowRule[] = [
  {
    kind: 'CJSResolvesToESM',
    resolutionKind: 'node16-cjs',
    // Every @cynco package deliberately ships ESM-only, so `require()` from a
    // CJS consumer necessarily lands on an ESM file — that is the design, not
    // a mismatch. Node >= 20.19 supports require(esm) natively; older
    // CJS-only consumers were never a supported target, and "fixing" this
    // would mean dual-publishing CJS builds.
    reason:
      'ESM-only by design; require(esm) works on Node >= 20.19 and CJS-only ' +
      'consumers are not a supported target',
  },
  {
    kind: 'NoResolution',
    resolutionKind: 'node10',
    // node10 resolution reads `main`/`typesVersions`, which ESM-only packages
    // may not carry. No working consumer is masked: actual Node 10-era
    // runtimes cannot load ESM at all, so a node10 *types* resolution failure
    // only affects TS configs still on moduleResolution node10 — which must
    // use node16/bundler to consume these packages anyway.
    reason:
      'node10 resolution cannot load ESM-only packages at runtime regardless; ' +
      'TS consumers need moduleResolution node16/bundler',
  },
];

export interface AttwVerdict {
  failures: Problem[];
  allowed: { problem: Problem; reason: string }[];
}

/**
 * Applies the ESM-only allowlist to attw's findings. Any problem without an
 * applicable rule fails the release — including node16-esm/bundler
 * resolution failures, missing named exports, false-ESM/CJS type mismatches,
 * and internal resolution errors (a d.ts importing a private package
 * surfaces as the latter).
 */
export function evaluateAttwProblems(
  problems: readonly Problem[],
  manifest: PublishManifest
): AttwVerdict {
  const rules = manifest.type === 'module' ? ESM_ONLY_ATTW_ALLOWLIST : [];
  const verdict: AttwVerdict = { failures: [], allowed: [] };
  for (const problem of problems) {
    const rule = rules.find(
      (candidate) =>
        candidate.kind === problem.kind &&
        'resolutionKind' in problem &&
        candidate.resolutionKind === problem.resolutionKind
    );
    if (rule === undefined) {
      verdict.failures.push(problem);
    } else {
      verdict.allowed.push({ problem, reason: rule.reason });
    }
  }
  return verdict;
}

/**
 * Human-readable one-liner for an attw problem. attw's own renderers are
 * table-oriented; release logs want one offender per line.
 */
export function describeAttwProblem(problem: Problem): string {
  const parts: string[] = [problem.kind];
  if ('entrypoint' in problem) {
    parts.push(
      `entrypoint "${problem.entrypoint}" (${problem.resolutionKind})`
    );
  }
  if ('typesFileName' in problem) {
    parts.push(
      `types ${problem.typesFileName} vs impl ${problem.implementationFileName}`
    );
  }
  if ('fileName' in problem) {
    parts.push(`in ${problem.fileName}`);
  }
  return parts.join(' — ');
}

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

type StdioOption =
  | 'inherit'
  | [number, number, number]
  | ['ignore', 'pipe', 'pipe'];

// moon captures task stdio, so child processes do not always see a TTY even
// when a maintainer ran `moonx` from an interactive terminal. Publish-time npm
// 2FA needs a real terminal for retry prompts and web-based authentication,
// so the upload and dist-tag steps attach directly to /dev/tty when possible.
function openTerminalStdio(): [number, number, number] | null {
  let input: number | null = null;
  let output: number | null = null;
  let error: number | null = null;

  try {
    input = openSync('/dev/tty', 'r');
    output = openSync('/dev/tty', 'w');
    error = openSync('/dev/tty', 'w');
    return [input, output, error];
  } catch {
    for (const fd of [input, output, error]) {
      if (fd !== null) {
        closeSync(fd);
      }
    }
    return null;
  }
}

function closeTerminalStdio(stdio: StdioOption): void {
  if (Array.isArray(stdio)) {
    for (const fd of stdio) {
      if (typeof fd === 'number') {
        closeSync(fd);
      }
    }
  }
}

function resolveStdio(options: {
  inherit?: boolean;
  preferTerminal?: boolean;
}): StdioOption {
  if (options.preferTerminal === true) {
    const terminalStdio = openTerminalStdio();
    if (terminalStdio !== null) {
      return terminalStdio;
    }
  }
  return options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'];
}

// Runs a command to completion, throwing (with an OTP-redacted command line)
// on failure. CI is unset in the child env: pnpm publish CI-gates itself and
// this script must behave identically from agent shells and human terminals.
function run(
  cmd: string,
  args: readonly string[],
  options: { cwd?: string; inherit?: boolean; preferTerminal?: boolean } = {}
): string {
  const stdio = resolveStdio(options);
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio,
    encoding: 'utf8',
    env: { ...process.env, CI: '' },
  });
  closeTerminalStdio(stdio);
  if (result.status !== 0) {
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(
      `${cmd} ${redactOtp(args).join(' ')} exited with ${result.status}\n${stdout}\n${stderr}`
    );
  }
  return result.stdout?.toString() ?? '';
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

const workspaceRoot = resolve(import.meta.dir, '..');

// Confirms the working tree is clean and (for real publishes) that npm auth
// exists, so release artifacts can be reproduced from committed source.
function preflight(flags: CliFlags): void {
  if (!flags.allowDirty) {
    const status = run('git', ['status', '--porcelain']);
    if (status.trim().length > 0) {
      throw new Error(
        `Working tree is dirty. Commit/stash changes or pass --dirty.\n${status}`
      );
    }
  }

  // Dry runs never touch the registry, so they stay runnable offline and
  // before `pnpm login`.
  if (!flags.dryRun) {
    const whoami = run('pnpm', ['whoami']).trim();
    if (whoami.length === 0) {
      throw new Error('pnpm whoami returned empty — run pnpm login first.');
    }
    console.log(`npm user: ${whoami}`);
  }

  if (flags.releaseBranch != null) {
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (branch !== flags.releaseBranch) {
      throw new Error(
        `Expected to be on branch "${flags.releaseBranch}" but HEAD is "${branch}".`
      );
    }
  }
}

// Runs the guard chain this script owns: the pnpm-version pin check plus the
// package build. Equivalent to `moon run <project>:prepublish`, run directly
// so failures print the offending step instead of the aggregator.
function runGuardsAndBuild(project: string, packageDir: string): void {
  console.log(`[publish] checking pnpm version pin`);
  run('bun', [join(workspaceRoot, 'scripts', 'assert-pnpm-version.ts')], {
    cwd: packageDir,
    inherit: true,
  });
  console.log(`[publish] building ${project}`);
  run('moon', ['run', `${project}:build`], { cwd: packageDir, inherit: true });
}

// Asks pnpm to produce the same tarball it would upload. pnpm pack rewrites
// `workspace:*` dependency ranges to their resolved versions, which is why
// the pipeline packs first and rewrites the *unpacked* manifest afterwards.
function packTarball(destination: string, cwd: string): string {
  console.log(`[publish] packing tarball into ${destination}`);
  mkdirSync(destination, { recursive: true });
  run('pnpm', ['pack', '--pack-destination', destination], {
    cwd,
    inherit: true,
  });
  const entries = readdirSync(destination).filter((name) =>
    name.endsWith('.tgz')
  );
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one .tgz in ${destination}, found ${entries.length}`
    );
  }
  return join(destination, entries[0] ?? '');
}

function untar(tarballPath: string, into: string): void {
  mkdirSync(into, { recursive: true });
  run('tar', ['-xzf', tarballPath, '-C', into]);
}

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// Verifies an unpacked publish payload end to end: manifest dependency
// hygiene, forbidden import specifiers in every shipped text file, no
// incremental-build droppings, every exports entry backed by a real file,
// and the docs npm renders (README/LICENSE) present.
function assertPublishPayload(payloadDir: string): void {
  const manifest = JSON.parse(
    readFileSync(join(payloadDir, 'package.json'), 'utf8')
  ) as PublishManifest;

  const forbidden = [...PRIVATE_PACKAGES];
  const offenders: string[] = [];

  for (const offender of findManifestDependencyOffenders(manifest, forbidden)) {
    offenders.push(`package.json (${offender})`);
  }

  for (const file of collectFiles(payloadDir)) {
    const rel = relative(payloadDir, file);
    if (file.endsWith('.tsbuildinfo')) {
      offenders.push(`${rel} (tsbuildinfo leaked into payload)`);
      continue;
    }
    // Sourcemaps embed pre-bundling source text; nothing in them resolves
    // at runtime.
    if (file.endsWith('.map')) {
      continue;
    }
    const contents = readFileSync(file, 'utf8');
    for (const name of findQuotedSpecifierOffenders(contents, forbidden)) {
      offenders.push(`${rel} (imports ${name})`);
    }
  }

  for (const exportPath of collectExportPaths(manifest.exports)) {
    if (!existsSync(join(payloadDir, exportPath))) {
      offenders.push(`package.json exports -> ${exportPath} (file missing)`);
    }
  }

  for (const doc of ['README.md', 'LICENSE.md']) {
    if (!existsSync(join(payloadDir, doc))) {
      offenders.push(`${doc} missing from payload`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      ['Publish payload verification failed:', ...offenders].join('\n  ')
    );
  }
}

// Runs the consumer-correctness tools against the artifact that ships: publint
// over the extracted final payload (every file in that dir came out of the
// final tarball, hence `pack: false`) and attw over the final tarball bytes
// themselves. Kept separate from assertPublishPayload because these tools are
// async and external — the in-house payload checks stay synchronous and
// dependency-free.
async function assertConsumerCorrectness(
  finalTarballPath: string,
  payloadDir: string
): Promise<void> {
  const offenders: string[] = [];

  console.log('[publish] publint: linting extracted final payload');
  const { messages, pkg } = await publint({
    pkgDir: payloadDir,
    pack: false,
    // Suggestions are style noise at release time; see
    // partitionPublintMessages for the error/warning threshold rationale.
    level: 'warning',
  });
  const { errors, warnings } = partitionPublintMessages(messages);
  for (const message of warnings) {
    console.warn(
      `[publish] publint warning: ${formatMessage(message, pkg) ?? message.code}`
    );
  }
  for (const message of errors) {
    offenders.push(`publint: ${formatMessage(message, pkg) ?? message.code}`);
  }

  console.log(
    '[publish] attw: resolving entrypoints (node10/node16-cjs/node16-esm/bundler) against final tarball'
  );
  const tarballData = new Uint8Array(readFileSync(finalTarballPath));
  const result = await checkPackage(createPackageFromTarballData(tarballData));
  if (result.types === false) {
    offenders.push('attw: package ships no type declarations at all');
  } else {
    const manifest = JSON.parse(
      readFileSync(join(payloadDir, 'package.json'), 'utf8')
    ) as PublishManifest;
    const { failures, allowed } = evaluateAttwProblems(
      result.problems,
      manifest
    );
    for (const { problem, reason } of allowed) {
      console.warn(
        `[publish] attw allowlisted: ${describeAttwProblem(problem)} — ${reason}`
      );
    }
    for (const problem of failures) {
      offenders.push(`attw: ${describeAttwProblem(problem)}`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      ['Consumer correctness verification failed:', ...offenders].join('\n  ')
    );
  }
  console.log('[publish] consumer correctness verified (publint + attw)');
}

// Line-level manifest diff for the dry-run report: enough to eyeball that
// only the release-only fields disappeared.
function describeDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const removed = beforeLines.filter((line) => !afterLines.includes(line));
  const added = afterLines.filter((line) => !beforeLines.includes(line));
  const removedText = removed.map((line) => `- ${line}`).join('\n');
  const addedText = added.map((line) => `+ ${line}`).join('\n');
  return `${removedText}\n${addedText}`.trim();
}

function publish(tarballPath: string, tag: string, otp: string | null): void {
  const args = publishArgs(tarballPath, tag, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, { inherit: true, preferTerminal: true });
}

function dryRunPublish(
  tarballPath: string,
  tag: string,
  otp: string | null
): void {
  const args = dryRunPublishArgs(tarballPath, tag, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, { inherit: true });
}

function promoteLatest(
  packageName: string,
  version: string,
  otp: string | null
): void {
  console.log(`[publish] promoting ${packageName}@${version} to latest`);
  const args = distTagAddArgs(packageName, version, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, { inherit: true, preferTerminal: true });
}

function tagRelease(packageName: string, version: string): void {
  const tagName = `${packageName}@${version}`;
  console.log(`[publish] git tag ${tagName}`);
  run('git', ['tag', '-a', tagName, '-m', tagName], { inherit: true });
  run('git', ['push', 'origin', tagName], { inherit: true });
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // moon runs the `publish` task with the package directory as cwd, which is
  // how a single shared script knows which package it is releasing.
  const packageDir = process.cwd();
  const sourceManifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8')
  ) as PublishManifest;
  const config = PUBLISH_CONFIGS[sourceManifest.name];
  if (config === undefined) {
    throw new Error(
      `${sourceManifest.name} is not a publishable package. Run via ` +
        `\`moonx <project>:publish\` for one of: ${Object.keys(PUBLISH_CONFIGS).join(', ')}.`
    );
  }

  const flags = parseArgs(process.argv.slice(2));

  preflight(flags);
  runGuardsAndBuild(config.project, packageDir);

  // The workdir is intentionally left behind (tmpdir is OS-managed): the
  // final tarball is what consumer smoke tests install before promotion.
  const workDir = mkdtempSync(
    join(tmpdir(), `cynco-${config.project}-publish-`)
  );
  console.log(`[publish] workdir: ${workDir}`);

  const sourceTarballPath = packTarball(join(workDir, 'source'), packageDir);
  const unpackedRoot = join(workDir, 'unpacked');
  untar(sourceTarballPath, unpackedRoot);
  const payloadDir = join(unpackedRoot, 'package');

  const manifestPath = join(payloadDir, 'package.json');
  const before = readFileSync(manifestPath, 'utf8');
  const rewritten = rewritePublishManifest(
    JSON.parse(before) as PublishManifest
  );
  const after = `${JSON.stringify(rewritten, null, 2)}\n`;
  writeFileSync(manifestPath, after);

  assertPublishPayload(payloadDir);

  // Repack the rewritten payload and verify the *extracted final tarball*
  // once more: the artifact that ships is the artifact that was checked.
  const finalTarballPath = packTarball(join(workDir, 'final'), payloadDir);
  const verifyRoot = join(workDir, 'verify');
  untar(finalTarballPath, verifyRoot);
  const finalPayloadDir = join(verifyRoot, 'package');
  assertPublishPayload(finalPayloadDir);

  // Consumer-correctness gate (publint + attw) on the same final artifact.
  // Deliberately before the dry-run/publish fork: a --dry-run that skipped
  // it would rehearse less than the real release verifies.
  await assertConsumerCorrectness(finalTarballPath, finalPayloadDir);

  if (flags.dryRun) {
    dryRunPublish(finalTarballPath, flags.tag, flags.otp);
    console.log('\n--- package.json diff ---');
    console.log(describeDiff(before, after));
    console.log('\n--- final tarball listing ---');
    run('tar', ['-tzf', finalTarballPath], { inherit: true });
    console.log(
      `\nDry-run complete. Final tarball: ${finalTarballPath}. Would publish ` +
        `${rewritten.name}@${rewritten.version} to tag "${flags.tag}".`
    );
    return;
  }

  publish(finalTarballPath, flags.tag, flags.otp);

  if (flags.promoteLatest) {
    promoteLatest(rewritten.name, rewritten.version, flags.otp);
  }

  if (flags.tagRelease) {
    tagRelease(rewritten.name, rewritten.version);
  }

  console.log(
    `\n[publish] done — published ${rewritten.name}@${rewritten.version} to ${flags.tag}`
  );
}

if (import.meta.main) {
  await main();
}
