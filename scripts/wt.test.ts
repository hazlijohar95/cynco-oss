import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findWorktreeEnv } from './load-worktree-env.mjs';
import {
  allocateOffset,
  OFFSET_STEP,
  parseEnvText,
  parseWorktreeList,
  planSyncOffsets,
  PORT_BASES,
  portsForOffset,
  renderWorktreeEnv,
  worktreeDirName,
} from './wt';

describe('parseWorktreeList', () => {
  test('parses primary, linked, and detached records', () => {
    const porcelain = [
      'worktree /repos/cynco-ledger',
      'HEAD aaaa111',
      'branch refs/heads/main',
      '',
      'worktree /repos/cynco-ledger-worktrees/fix-keyboard',
      'HEAD bbbb222',
      'branch refs/heads/fix/keyboard',
      '',
      'worktree /repos/cynco-ledger-worktrees/spike',
      'HEAD cccc333',
      'detached',
      '',
    ].join('\n');

    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: '/repos/cynco-ledger',
        head: 'aaaa111',
        branch: 'refs/heads/main',
        isMain: true,
      },
      {
        path: '/repos/cynco-ledger-worktrees/fix-keyboard',
        head: 'bbbb222',
        branch: 'refs/heads/fix/keyboard',
        isMain: false,
      },
      {
        path: '/repos/cynco-ledger-worktrees/spike',
        head: 'cccc333',
        branch: null,
        isMain: false,
      },
    ]);
  });

  test('tolerates a missing trailing blank line and empty input', () => {
    const record = parseWorktreeList(
      'worktree /repos/cynco-ledger\nHEAD aaaa111\nbranch refs/heads/main'
    );
    expect(record).toHaveLength(1);
    expect(record[0]?.isMain).toBe(true);
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('parseEnvText', () => {
  test('reads keys, skips comments, and strips value quotes', () => {
    const parsed = parseEnvText(
      [
        '# generated file',
        'CYNCO_WORKTREE_NAME="fix-keyboard"',
        "CYNCO_PORT_OFFSET='1000'",
        'PLAIN=value',
      ].join('\n')
    );
    expect(parsed).toEqual({
      CYNCO_WORKTREE_NAME: 'fix-keyboard',
      CYNCO_PORT_OFFSET: '1000',
      PLAIN: 'value',
    });
  });

  test('skips malformed lines instead of throwing', () => {
    expect(parseEnvText('no-equals-sign\n=no-key\nOK=1')).toEqual({ OK: '1' });
  });
});

describe('allocateOffset', () => {
  test('hands out the lowest free slot, never slot 0', () => {
    expect(allocateOffset([])).toBe(OFFSET_STEP);
    expect(allocateOffset([OFFSET_STEP])).toBe(2 * OFFSET_STEP);
    // Slot 1 was freed (worktree removed): it is reused before slot 3.
    expect(allocateOffset([2 * OFFSET_STEP])).toBe(OFFSET_STEP);
    // An explicit claim of 0 changes nothing — 0 is always reserved.
    expect(allocateOffset([0])).toBe(OFFSET_STEP);
  });

  test('ignores out-of-scheme claims without crashing', () => {
    // A hand-edited offset that is not a multiple of the step just occupies
    // its own number; allocation still returns the lowest free multiple.
    expect(allocateOffset([137])).toBe(OFFSET_STEP);
  });
});

describe('planSyncOffsets', () => {
  test('a valid claim is never displaced by an earlier unclaimed worktree', () => {
    // git list order puts the unclaimed worktree first; a single in-order
    // pass would hand it slot 1 and shove the valid claimant off its live
    // ports. The plan registers claims first, so the newcomer fills the gap.
    expect(planSyncOffsets([null, OFFSET_STEP])).toEqual([
      2 * OFFSET_STEP,
      OFFSET_STEP,
    ]);
  });

  test('valid unique claims survive verbatim in any order', () => {
    expect(
      planSyncOffsets([3 * OFFSET_STEP, OFFSET_STEP, 2 * OFFSET_STEP])
    ).toEqual([3 * OFFSET_STEP, OFFSET_STEP, 2 * OFFSET_STEP]);
  });

  test('duplicate claims: first claimant keeps the slot, the rest move', () => {
    expect(planSyncOffsets([OFFSET_STEP, OFFSET_STEP])).toEqual([
      OFFSET_STEP,
      2 * OFFSET_STEP,
    ]);
  });

  test('claims of slot 0 are invalid — the primary owns it', () => {
    expect(planSyncOffsets([0])).toEqual([OFFSET_STEP]);
  });

  test('idempotent: replanning its own output changes nothing', () => {
    const first = planSyncOffsets([null, OFFSET_STEP, null, OFFSET_STEP]);
    expect(planSyncOffsets(first)).toEqual(first);
  });
});

describe('portsForOffset', () => {
  test('offset 0 reproduces the historical default ports exactly', () => {
    expect(portsForOffset(0)).toEqual({
      demo: 4600,
      docs: 4700,
      journalsE2e: 4283,
      accountsE2e: 4383,
      journalsE2eManual: 9231,
      accountsE2eManual: 9232,
    });
  });

  test('shifts every base by the worktree offset', () => {
    const ports = portsForOffset(2000);
    expect(ports.demo).toBe(6600);
    expect(ports.docs).toBe(6700);
    expect(ports.journalsE2e).toBe(6283);
    expect(ports.accountsE2e).toBe(6383);
  });

  test('no two worktrees can ever share a port', () => {
    // The invariant behind OFFSET_STEP: bases span a band narrower than the
    // step, so distinct offsets yield disjoint port sets. Checked pairwise
    // across a realistic slot range so a future base addition that breaks
    // the invariant fails here first.
    const slots = [0, 1, 2, 3, 10, 56];
    for (const a of slots) {
      for (const b of slots) {
        if (a === b) continue;
        const portsA = new Set(Object.values(portsForOffset(a * OFFSET_STEP)));
        for (const port of Object.values(portsForOffset(b * OFFSET_STEP))) {
          expect(portsA.has(port)).toBe(false);
        }
      }
    }
  });

  test('every port stays below the TCP ceiling at the maximum slot', () => {
    for (const port of Object.values(portsForOffset(56 * OFFSET_STEP))) {
      expect(port).toBeLessThan(65536);
    }
  });
});

describe('renderWorktreeEnv', () => {
  test('emits the two keys the consumers read, with a trailing newline', () => {
    const text = renderWorktreeEnv('fix-keyboard', 1000);
    expect(text.endsWith('\n')).toBe(true);
    // Round-trip through the same parser moon-adjacent consumers use.
    expect(parseEnvText(text)).toEqual({
      CYNCO_WORKTREE_NAME: 'fix-keyboard',
      CYNCO_PORT_OFFSET: '1000',
    });
  });
});

describe('worktreeDirName', () => {
  test('flattens branch separators into a single directory name', () => {
    expect(worktreeDirName('fix/keyboard')).toBe('fix-keyboard');
    expect(worktreeDirName('alex/fix/drag//drop')).toBe('alex-fix-drag-drop');
    expect(worktreeDirName('plain')).toBe('plain');
    expect(worktreeDirName('/leading/and/trailing/')).toBe(
      'leading-and-trailing'
    );
  });
});

describe('findWorktreeEnv', () => {
  test('walks up to the env file but stops at the .git boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'cynco-wt-env-'));
    const worktree = join(root, 'checkout');
    const nested = join(worktree, 'packages', 'journals');
    mkdirSync(nested, { recursive: true });
    // Linked worktrees have a `.git` FILE at the root; a plain file works
    // for the boundary check.
    writeFileSync(join(worktree, '.git'), 'gitdir: elsewhere\n');
    writeFileSync(
      join(worktree, '.env.worktree'),
      renderWorktreeEnv('checkout', 3000)
    );
    // Decoy above the worktree root must never be reached.
    writeFileSync(join(root, '.env.worktree'), 'CYNCO_PORT_OFFSET=9\n');

    expect(findWorktreeEnv(nested)).toEqual({
      CYNCO_WORKTREE_NAME: 'checkout',
      CYNCO_PORT_OFFSET: '3000',
    });
  });

  test('returns empty for a checkout without an env file (primary clone)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cynco-wt-noenv-'));
    const nested = join(root, 'apps', 'docs');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, '.git'));
    expect(findWorktreeEnv(nested)).toEqual({});
  });
});

describe('port base table', () => {
  test('bases fit inside one offset step so thousand-blocks stay disjoint', () => {
    // demo..docs span 417 ports (4283..4700); the manual e2e pair sits in
    // its own band. If a new base widens a band past OFFSET_STEP, the
    // pairwise test above fails too — this one names the invariant.
    const bases = Object.values(PORT_BASES);
    const low = bases.filter((base) => base < 9000);
    expect(Math.max(...low) - Math.min(...low)).toBeLessThan(OFFSET_STEP);
    const high = bases.filter((base) => base >= 9000);
    expect(Math.max(...high) - Math.min(...high)).toBeLessThan(OFFSET_STEP);
  });
});
