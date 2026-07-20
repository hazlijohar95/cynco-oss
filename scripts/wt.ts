#!/usr/bin/env bun
//
// Worktree manager for parallel development.
//
//   bun scripts/wt.ts create <branch> [--base <ref>]
//   bun scripts/wt.ts list
//   bun scripts/wt.ts remove <name> [--keep-branch] [--force]
//   bun scripts/wt.ts sync
//
// (also exposed as the `root:wt` moon task: `moonx root:wt -- <args>`)
//
// Design notes (see CONTRIBUTING.md "Parallel worktrees" for the user-facing
// summary):
//
// - Worktrees live at <primary>-worktrees/<name>/, a sibling of the primary
//   checkout, where <name> is the branch with '/' replaced by '-'. Each
//   worktree owns a port offset stored in <worktree>/.env.worktree. Dev and
//   e2e tasks resolve ports as `${CYNCO_PORT_OFFSET:-0} + <base>` so the
//   primary checkout (no env file) keeps its historical ports unchanged.
// - Discovery is stateless: `git worktree list --porcelain` is the source of
//   truth for which worktrees exist, and each worktree's own `.env.worktree`
//   is the source of truth for its offset. There is no central registry, so
//   `sync` can always rebuild a consistent state from disk.
// - Offsets step by 1000 because the base ports span 4283..4700 — a band
//   narrower than the step — so per-worktree thousand-blocks can never
//   overlap. A 100 step would collide: demo (4600) + 100 lands exactly on
//   docs' default 4700.
// - Worktrees created by other tools (agent harnesses etc.) have no
//   `.env.worktree`; they show up in `list` but claim no offset until `sync`
//   assigns one.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Base ports for every port-binding task in the repo. A worktree's actual
// port is base + offset; keep this table in sync with the moon.yml /
// playwright.config.ts consumers listed per entry.
export const PORT_BASES = {
  /** demo:dev / demo:serve (apps/demo/moon.yml). */
  demo: 4600,
  /** docs:dev / docs:serve (apps/docs/moon.yml). */
  docs: 4700,
  /** journals playwright webServer (packages/journals/test/e2e). */
  journalsE2e: 4283,
  /** accounts playwright webServer (packages/accounts/test/e2e). */
  accountsE2e: 4383,
  /** journals:test-e2e-server manual-run default (packages/journals/moon.yml). */
  journalsE2eManual: 9231,
  /** accounts:test-e2e-server manual-run default (packages/accounts/moon.yml). */
  accountsE2eManual: 9232,
} as const;

export type PortKey = keyof typeof PORT_BASES;
export type PortMap = Record<PortKey, number>;

// Offsets are slot index x 1000 (see header note on why not 100). Slot 0 is
// the primary checkout and is never allocated. The cap keeps the highest base
// (9232) below the 65535 TCP port ceiling.
export const OFFSET_STEP = 1000;
const MAX_SLOT = 56;

interface WorktreeRecord {
  path: string;
  head: string | null;
  /** `refs/heads/<name>` as reported by git, or null when detached. */
  branch: string | null;
  /** True for the primary (non-linked) checkout — always listed first. */
  isMain: boolean;
}

interface ManagedWorktree extends WorktreeRecord {
  /** From `.env.worktree`; null when the file is absent or malformed. */
  name: string | null;
  /** From `.env.worktree`; null when unclaimed. The primary is implicitly 0. */
  offset: number | null;
}

// -----------------------------------------------------------------------------
// Pure helpers (unit-tested in wt.test.ts)
// -----------------------------------------------------------------------------

// Parse `git worktree list --porcelain` output. Each record is a block of
// `key value` lines terminated by a blank line; the fields we need are
// `worktree <path>`, `HEAD <sha>`, and `branch refs/heads/<name>` (absent
// when detached). The first record is always the primary checkout.
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: { path?: string; head?: string; branch?: string } = {};

  const flush = (): void => {
    if (current.path === undefined) {
      current = {};
      return;
    }
    records.push({
      path: current.path,
      head: current.head ?? null,
      branch: current.branch ?? null,
      isMain: records.length === 0,
    });
    current = {};
  };

  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length);
    }
  }
  flush();
  return records;
}

// Parse dotenv-style text: `KEY=value` lines, `#` comments, optional single
// or double quotes around values. Degrades gracefully — malformed lines are
// skipped rather than throwing, so a hand-mangled `.env.worktree` reads as
// "unclaimed" instead of breaking every wt command.
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Lowest free slot wins: deterministic given the same set of live claims, and
// stable for existing worktrees because sync/create never reassign a valid
// claim. Slot 0 (the primary's default ports) is never handed out.
export function allocateOffset(claimed: readonly number[]): number {
  const taken = new Set<number>(claimed);
  taken.add(0);
  for (let slot = 1; slot <= MAX_SLOT; slot += 1) {
    const offset = slot * OFFSET_STEP;
    if (!taken.has(offset)) return offset;
  }
  throw new Error(`wt: all ${MAX_SLOT} port-offset slots are claimed`);
}

export function portsForOffset(offset: number): PortMap {
  const out: Partial<PortMap> = {};
  for (const key of Object.keys(PORT_BASES) as PortKey[]) {
    out[key] = PORT_BASES[key] + offset;
  }
  return out as PortMap;
}

// The exact `.env.worktree` payload. Kept as a pure renderer so tests can pin
// the format that moon's `envFile` option and load-worktree-env.mjs parse.
export function renderWorktreeEnv(name: string, offset: number): string {
  return [
    '# Generated by scripts/wt.ts (`bun scripts/wt.ts sync` rewrites it).',
    '# Gitignored per-worktree state; do not commit or edit by hand.',
    `CYNCO_WORKTREE_NAME=${name}`,
    `CYNCO_PORT_OFFSET=${offset}`,
    '',
  ].join('\n');
}

// Branch names may contain '/', which cannot appear in a single directory
// name; everything else passes through so `list` output maps obviously back
// to branches.
export function worktreeDirName(branch: string): string {
  return branch.replace(/[/\\]+/g, '-').replace(/^-+|-+$/g, '');
}

// Decide every linked worktree's offset in two passes so claims really are
// sticky: pass 1 registers each valid claim (first claimant wins a
// duplicate), pass 2 fills the gaps with the lowest free slot. A single
// in-order pass would let an earlier-listed unclaimed worktree grab a slot a
// later worktree validly claims, silently moving that worktree's live ports.
// Input is the claimed offsets of the linked worktrees in `git worktree
// list` order (null = unclaimed/malformed); output is parallel to it.
export function planSyncOffsets(claims: readonly (number | null)[]): number[] {
  const seen = new Set<number>([0]);
  const kept: (number | null)[] = claims.map((claim) => {
    if (claim === null || claim <= 0 || seen.has(claim)) return null;
    seen.add(claim);
    return claim;
  });
  return kept.map((claim) => {
    if (claim !== null) return claim;
    const offset = allocateOffset([...seen]);
    seen.add(offset);
    return offset;
  });
}

// -----------------------------------------------------------------------------
// Filesystem / git plumbing
// -----------------------------------------------------------------------------

function runGit(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

// Read a worktree's `.env.worktree` claim. Absent or malformed files yield
// null fields — the worktree exists but owns no offset.
function readWorktreeEnv(worktreePath: string): {
  name: string | null;
  offset: number | null;
} {
  const envPath = join(worktreePath, '.env.worktree');
  if (!existsSync(envPath)) return { name: null, offset: null };
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvText(readFileSync(envPath, 'utf8'));
  } catch {
    return { name: null, offset: null };
  }
  const rawOffset = parsed['CYNCO_PORT_OFFSET'];
  const offset = rawOffset === undefined ? Number.NaN : Number(rawOffset);
  return {
    name: parsed['CYNCO_WORKTREE_NAME'] ?? null,
    offset: Number.isFinite(offset) ? offset : null,
  };
}

// Stateless discovery: git enumerates the worktrees, each worktree's own
// `.env.worktree` supplies its claim.
function enumerateWorktrees(): ManagedWorktree[] {
  const porcelain = runGit(['worktree', 'list', '--porcelain']);
  return parseWorktreeList(porcelain).map((record) => ({
    ...record,
    ...readWorktreeEnv(record.path),
  }));
}

// Write `.env.worktree` only when the content differs, so repeated syncs are
// no-ops for mtime-sensitive watchers.
function writeWorktreeEnv(
  worktreePath: string,
  name: string,
  offset: number
): boolean {
  const envPath = join(worktreePath, '.env.worktree');
  const next = renderWorktreeEnv(name, offset);
  if (existsSync(envPath) && readFileSync(envPath, 'utf8') === next) {
    return false;
  }
  writeFileSync(envPath, next, 'utf8');
  return true;
}

function shortBranch(worktree: WorktreeRecord): string {
  if (worktree.branch === null) return '(detached)';
  return worktree.branch.replace(/^refs\/heads\//, '');
}

function pidsOnPort(port: number): number[] {
  const result = spawnSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

// Terminate listeners on the worktree's ports before removal: a dev server
// left running from a deleted checkout would silently squat the offset's
// ports for the next claimant. SIGTERM first, short pause, SIGKILL survivors.
function killPorts(ports: readonly number[]): void {
  for (const port of ports) {
    const pids = pidsOnPort(port);
    if (pids.length === 0) continue;
    console.log(`[wt] port ${port}: terminating ${pids.join(', ')}`);
    spawnSync('kill', ['-TERM', ...pids.map(String)], { stdio: 'ignore' });
  }
  if (ports.some((port) => pidsOnPort(port).length > 0)) {
    spawnSync('sleep', ['0.3']);
  }
  for (const port of ports) {
    const survivors = pidsOnPort(port);
    if (survivors.length === 0) continue;
    console.log(`[wt] port ${port}: SIGKILL ${survivors.join(', ')}`);
    spawnSync('kill', ['-KILL', ...survivors.map(String)], {
      stdio: 'ignore',
    });
  }
}

function printPortSummary(name: string, offset: number, path: string): void {
  const ports = portsForOffset(offset);
  console.log(`
Worktree: ${name} (offset ${offset})
  demo dev/serve:   http://localhost:${ports.demo}
  docs dev/serve:   http://localhost:${ports.docs}
  journals e2e:     http://127.0.0.1:${ports.journalsE2e}
  accounts e2e:     http://127.0.0.1:${ports.accountsE2e}

cd ${path}
`);
}

// -----------------------------------------------------------------------------
// create
// -----------------------------------------------------------------------------

// Create a worktree for <branch> at <primary>-worktrees/<name>, claim the
// lowest free offset, and install dependencies. Reuses the branch when it
// already exists locally; otherwise creates it from --base (default: main).
function cmdCreate(rest: readonly string[]): number {
  let branch: string | undefined;
  let base = 'main';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? '';
    if (arg === '--base') {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('wt create: --base requires a ref');
        return 1;
      }
      base = value;
      index += 1;
    } else if (!arg.startsWith('--') && branch === undefined) {
      branch = arg;
    } else {
      console.error(`wt create: unknown argument ${arg}`);
      return 1;
    }
  }
  if (branch === undefined || branch.length === 0) {
    console.error('wt create: missing <branch>');
    return 1;
  }

  const name = worktreeDirName(branch);
  if (name.length === 0) {
    console.error(`wt create: cannot derive a directory name from ${branch}`);
    return 1;
  }

  const worktrees = enumerateWorktrees();
  const main = worktrees.find((worktree) => worktree.isMain);
  if (main === undefined) {
    console.error('wt create: no primary worktree found (not a git repo?)');
    return 1;
  }
  for (const worktree of worktrees) {
    if (worktree.branch === `refs/heads/${branch}`) {
      console.error(
        `wt create: branch ${branch} is already checked out at ${worktree.path}`
      );
      return 1;
    }
    if (worktree.name === name) {
      console.error(
        `wt create: name ${name} is already claimed by ${worktree.path}`
      );
      return 1;
    }
  }

  const home = `${resolve(main.path)}-worktrees`;
  const worktreePath = join(home, name);
  if (existsSync(worktreePath)) {
    console.error(`wt create: ${worktreePath} already exists`);
    return 1;
  }
  mkdirSync(home, { recursive: true });

  // Attach the existing local branch when there is one; otherwise create the
  // branch rooted at --base. `git worktree add` refuses double-checkouts, so
  // the guard above is belt-and-braces for a clearer message.
  const branchExists =
    spawnSync('git', [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]).status === 0;
  const addArgs = branchExists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, base];
  const added = spawnSync('git', addArgs, { stdio: 'inherit' });
  if (added.status !== 0) return added.status ?? 1;

  const offset = allocateOffset(
    worktrees
      .map((worktree) => worktree.offset)
      .filter((claim): claim is number => claim !== null)
  );
  writeWorktreeEnv(worktreePath, name, offset);

  console.log(`\nInstalling dependencies in ${worktreePath}...`);
  const install = spawnSync('pnpm', ['install'], {
    cwd: worktreePath,
    stdio: 'inherit',
  });
  if (install.status !== 0) {
    console.error(
      'wt create: pnpm install failed; the worktree may be incomplete'
    );
    return install.status ?? 1;
  }

  printPortSummary(name, offset, worktreePath);
  return 0;
}

// -----------------------------------------------------------------------------
// list
// -----------------------------------------------------------------------------

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function cmdList(): number {
  for (const worktree of enumerateWorktrees()) {
    const label =
      worktree.name ?? (worktree.isMain ? '(primary)' : '(unclaimed)');
    const offset = worktree.isMain
      ? '0'
      : worktree.offset === null
        ? '—'
        : String(worktree.offset);
    console.log(
      `${padRight(label, 24)} offset=${padRight(offset, 6)} ${padRight(shortBranch(worktree), 36)} ${worktree.path}`
    );
  }
  return 0;
}

// -----------------------------------------------------------------------------
// remove
// -----------------------------------------------------------------------------

// Remove a worktree by its claimed name (falling back to directory basename
// for unclaimed ones). Kills its port listeners first so nothing keeps
// serving from a deleted checkout, then deletes the branch when merged
// (`git branch -d` refuses unmerged branches, which is the safety we want).
function cmdRemove(rest: readonly string[]): number {
  const keepBranch = rest.includes('--keep-branch');
  const force = rest.includes('--force');
  const name = rest.find((arg) => !arg.startsWith('--'));
  if (name === undefined) {
    console.error('wt remove: missing <name>');
    return 1;
  }

  const worktree = enumerateWorktrees().find(
    (candidate) =>
      !candidate.isMain &&
      (candidate.name === name || basename(candidate.path) === name)
  );
  if (worktree === undefined) {
    console.error(`wt remove: no linked worktree named "${name}"`);
    return 1;
  }

  if (worktree.offset !== null) {
    killPorts(Object.values(portsForOffset(worktree.offset)));
  }

  const removeArgs = ['worktree', 'remove'];
  if (force) removeArgs.push('--force');
  removeArgs.push(worktree.path);
  const removed = spawnSync('git', removeArgs, { stdio: 'inherit' });
  if (removed.status !== 0) return removed.status ?? 1;

  if (!keepBranch && worktree.branch !== null) {
    const branchName = shortBranch(worktree);
    const deleted = spawnSync('git', ['branch', '-d', branchName], {
      encoding: 'utf8',
    });
    if (deleted.status === 0) {
      console.log(`Deleted branch ${branchName} (was merged).`);
    } else {
      const reason = deleted.stderr.trim();
      console.log(
        `Left branch ${branchName} in place (${reason.length > 0 ? reason : 'unmerged'}).`
      );
    }
  }
  return 0;
}

// -----------------------------------------------------------------------------
// sync
// -----------------------------------------------------------------------------

// Re-derive every worktree's `.env.worktree` from what exists on disk. Valid
// unique claims are kept verbatim (offsets are sticky); missing, malformed,
// or duplicate claims get the lowest free slot. Running sync twice in a row
// is a no-op — that idempotence is what lets any checkout repair the whole
// set after manual `git worktree add/remove` surgery.
function cmdSync(): number {
  const worktrees = enumerateWorktrees();
  const linked = worktrees.filter((worktree) => !worktree.isMain);
  const offsets = planSyncOffsets(linked.map((worktree) => worktree.offset));

  for (const worktree of worktrees) {
    if (worktree.isMain) {
      console.log(
        `${padRight('(primary)', 24)} offset=0      ${worktree.path}`
      );
    }
  }
  for (const [index, worktree] of linked.entries()) {
    const offset = offsets[index] ?? 0;
    const name = worktree.name ?? basename(worktree.path);
    const changed = writeWorktreeEnv(worktree.path, name, offset);
    console.log(
      `${padRight(name, 24)} offset=${padRight(String(offset), 6)} ${changed ? '(updated)' : '(ok)'} ${worktree.path}`
    );
  }
  return 0;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

function cmdHelp(): number {
  console.log(`Usage: bun scripts/wt.ts <subcommand> [args]
       moonx root:wt -- <subcommand> [args]

Subcommands:
  create <branch> [--base <ref>]
      Create a worktree at <primary>-worktrees/<name> (name = branch with
      '/' -> '-'). Reuses the branch if it exists locally, otherwise creates
      it from --base (default: main). Claims the lowest free port offset,
      writes .env.worktree, and runs pnpm install.

  list
      One line per worktree: name, port offset, branch, path.

  remove <name> [--keep-branch] [--force]
      Kill listeners on the worktree's ports, remove the worktree, and delete
      its branch when merged. --force passes through to git worktree remove.

  sync
      Idempotently (re)write every linked worktree's .env.worktree: existing
      valid claims are kept, duplicates and gaps get the lowest free slot.

Ports: each worktree's tasks bind base + offset (offsets step by ${OFFSET_STEP}).
Bases: demo ${PORT_BASES.demo}, docs ${PORT_BASES.docs}, journals e2e ${PORT_BASES.journalsE2e}, accounts e2e ${PORT_BASES.accountsE2e}.
The primary checkout has no .env.worktree and keeps the default ports.
`);
  return 0;
}

const commands: Record<string, (rest: string[]) => number> = {
  create: cmdCreate,
  list: cmdList,
  remove: cmdRemove,
  sync: cmdSync,
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const sub = args[0];
  const command = sub === undefined ? undefined : commands[sub];
  if (command === undefined) {
    cmdHelp();
    process.exit(sub === undefined ? 0 : 1);
  }
  try {
    process.exit(command(args.slice(1)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
