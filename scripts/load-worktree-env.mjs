/* oxlint-disable typescript/strict-boolean-expressions --
   tsgolint cannot resolve JSDoc types for this out-of-program .mjs (every
   package consumes it through the hand-written .d.mts beside it), so all
   values read as `any` and every conditional would trip the rule. The
   logic itself is covered by scripts/wt.test.ts. */

// Shared `.env.worktree` loader for configs that run outside a moon task
// (Playwright configs, or anything else launched directly in Node/Bun).
//
// Why this file exists: `scripts/wt.ts` writes `.env.worktree` at the
// worktree root, but its keys must reach `process.env`, and neither Node,
// Bun, Vite, Next, nor Playwright auto-load a file with that non-standard
// name — only the conventional `.env*` variants. moon tasks load the file
// via their `envFile` option, but direct invocations (e.g. `pnpm exec
// playwright test` from a package root) skip moon entirely. This helper
// closes that gap by letting configs pull the file in themselves.
//
// The walk starts at `startDir` (defaults to `process.cwd()`) and stops at
// either the first `.env.worktree` it finds or the nearest `.git` entry (the
// worktree root), whichever comes first. Values already present in
// `process.env` are never clobbered, so moon-injected vars stay
// authoritative.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Parse an env file into a plain record. Supports `KEY=value`, `# comments`,
// and optional surrounding single/double quotes on the value.
/** @param {string} path */
function parseEnvFile(path) {
  /** @type {Record<string, string>} */
  const out = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
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

// Walk up from `startDir` looking for `.env.worktree`. Returns the parsed
// contents, or an empty object if no file is found before hitting `.git`
// (a directory in the primary checkout, a file in linked worktrees) or the
// filesystem root.
/**
 * @param {string} [startDir]
 * @returns {Record<string, string>}
 */
export function findWorktreeEnv(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, '.env.worktree');
    if (existsSync(candidate)) {
      return parseEnvFile(candidate);
    }
    if (existsSync(resolve(dir, '.git'))) return {};
    const parent = dirname(dir);
    if (parent === dir) return {};
    dir = parent;
  }
}

// Load `.env.worktree` values into `process.env`. Existing keys win so that
// anything a moon task (or other caller) has already injected stays
// authoritative.
/**
 * @param {string} [startDir]
 * @returns {Record<string, string>}
 */
export function loadWorktreeEnv(startDir = process.cwd()) {
  const values = findWorktreeEnv(startDir);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}
