import { describe, expect, test } from 'bun:test';

import {
  checkCssFallbackMirror,
  checkCssNumberMirror,
  checkMirrorEntry,
  constAliasTarget,
  constTableEntries,
  type CssFallbackMirror,
  type CssNumberMirror,
  interfaceMembers,
  MIRROR_REGISTRY,
  type MirrorEntry,
  probeNumber,
  type SourceReader,
  stripComments,
  typeAliasBody,
} from './assert-lockstep';

// Synthetic two-file workspace: 'truth.ts' is the source of truth,
// 'mirror.ts' the hand copy. Each suite mutates the mirror to prove the
// checker actually fails on drift (a lockstep guard that cannot go red is
// worse than none).
const reader =
  (files: Record<string, string>): SourceReader =>
  (file) => {
    const text = files[file];
    if (text == null) {
      throw new Error(`fixture has no file ${file}`);
    }
    return text;
  };

describe('stripComments', () => {
  test('removes block and line comments, keeps code', () => {
    expect(stripComments('a; /* JPY: 0 */ b; // BHD: 3\nc;')).toBe(
      'a;  b; \nc;'
    );
  });
});

describe('interfaceMembers', () => {
  test('extracts normalized members, ignoring doc comments', () => {
    const source = `
      export interface Posting {
        /** Account path. */
        account: string;
        // signed
        amount: MinorUnits;
      }
    `;
    expect(interfaceMembers(source, 'Posting')).toEqual([
      'account: string',
      'amount: MinorUnits',
    ]);
  });

  test('brace-balances nested object types', () => {
    const source = 'export interface X { a: { b: string }; c: number; }';
    expect(interfaceMembers(source, 'X')).toEqual([
      'a: { b: string }',
      'c: number',
    ]);
  });

  test('returns null for an absent interface', () => {
    expect(interfaceMembers('export interface Y {}', 'X')).toBeNull();
  });
});

describe('typeAliasBody', () => {
  test('extracts a normalized alias body', () => {
    expect(
      typeAliasBody("export type EntryFlag = 'a' |\n  'b';", 'EntryFlag')
    ).toBe("'a' | 'b'");
  });

  test('returns null for an absent alias', () => {
    expect(typeAliasBody('export type A = 1;', 'B')).toBeNull();
  });
});

describe('constTableEntries', () => {
  test('parses key/value entries with comments and annotations', () => {
    const source = `
      export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
        // zero-decimal
        JPY: 0,
        BHD: 3,
      };
    `;
    expect(constTableEntries(source, 'CURRENCY_DECIMALS')).toEqual({
      JPY: '0',
      BHD: '3',
    });
  });

  test('unwraps Object.freeze and keeps nested commas intact', () => {
    const source = `
      export const AMOUNT_FORMAT_INDIAN: AmountFormat = Object.freeze({
        decimal: '.',
        group: ',',
        groupSizes: Object.freeze([3, 2]),
      });
    `;
    expect(constTableEntries(source, 'AMOUNT_FORMAT_INDIAN')).toEqual({
      decimal: "'.'",
      group: "','",
      groupSizes: 'Object.freeze([3, 2])',
    });
  });

  test('returns null for an absent const', () => {
    expect(constTableEntries('export const A = {};', 'B')).toBeNull();
  });
});

describe('checkMirrorEntry — interface', () => {
  const entry: MirrorEntry = {
    name: 'posting',
    kind: 'interface',
    sourceOfTruth: { file: 'truth.ts', symbol: 'Posting' },
    mirrors: [{ file: 'mirror.ts', symbol: 'Posting' }],
  };
  const truth = 'export interface Posting { account: string; amount: number; }';

  test('identical members pass (doc comments may differ)', () => {
    const files = {
      'truth.ts': truth,
      'mirror.ts':
        'export interface Posting { /** copy */ account: string; amount: number; }',
    };
    expect(checkMirrorEntry(entry, reader(files))).toEqual([]);
  });

  test('a missing member fails naming both files and the member', () => {
    const files = {
      'truth.ts': truth,
      'mirror.ts': 'export interface Posting { account: string; }',
    };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('amount: number');
    expect(violations[0]?.message).toContain('mirror.ts');
    expect(violations[0]?.message).toContain('truth.ts');
  });

  test('an extra member in the mirror fails', () => {
    const files = {
      'truth.ts': truth,
      'mirror.ts':
        'export interface Posting { account: string; amount: number; extra: boolean; }',
    };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('extra: boolean');
  });

  test('a renamed (absent) mirror symbol fails rather than passing', () => {
    const files = { 'truth.ts': truth, 'mirror.ts': 'export const x = 1;' };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('mirror not found');
  });
});

describe('checkMirrorEntry — type-alias', () => {
  const entry: MirrorEntry = {
    name: 'flag',
    kind: 'type-alias',
    sourceOfTruth: { file: 'truth.ts', symbol: 'EntryFlag' },
    mirrors: [{ file: 'mirror.ts', symbol: 'EntryFlag' }],
  };

  test('whitespace-different but equal bodies pass', () => {
    const files = {
      'truth.ts': "export type EntryFlag = 'cleared' | 'pending';",
      'mirror.ts': "export type EntryFlag =\n  'cleared' | 'pending';",
    };
    expect(checkMirrorEntry(entry, reader(files))).toEqual([]);
  });

  test('a drifted union fails with both bodies in the message', () => {
    const files = {
      'truth.ts': "export type EntryFlag = 'cleared' | 'pending';",
      'mirror.ts': "export type EntryFlag = 'cleared';",
    };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("'cleared' | 'pending'");
  });
});

describe('checkMirrorEntry — const-table', () => {
  const entry: MirrorEntry = {
    name: 'currency',
    kind: 'const-table',
    sourceOfTruth: { file: 'truth.ts', symbol: 'TABLE' },
    mirrors: [{ file: 'mirror.ts', symbol: 'TABLE' }],
  };

  test('reordered but equal entries pass (order is not drift)', () => {
    const files = {
      'truth.ts': 'export const TABLE = { JPY: 0, BHD: 3 };',
      'mirror.ts': 'export const TABLE = { BHD: 3, JPY: 0 };',
    };
    expect(checkMirrorEntry(entry, reader(files))).toEqual([]);
  });

  test('a partial copy fails per missing entry (the production incident)', () => {
    const files = {
      'truth.ts': 'export const TABLE = { JPY: 0, BHD: 3, KWD: 3 };',
      'mirror.ts': 'export const TABLE = { JPY: 0 };',
    };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.message).join('\n')).toContain('BHD: 3');
    expect(violations.map((v) => v.message).join('\n')).toContain('KWD: 3');
  });

  test('a changed value and an extra entry both fail', () => {
    const files = {
      'truth.ts': 'export const TABLE = { JPY: 0 };',
      'mirror.ts': 'export const TABLE = { JPY: 2, XXX: 9 };',
    };
    const violations = checkMirrorEntry(entry, reader(files));
    expect(violations).toHaveLength(2);
  });
});

describe('probeNumber', () => {
  test('captures the first group as a number', () => {
    expect(probeNumber('export const H = 44;', 'const H = (\\d+)')).toBe(44);
    expect(probeNumber('scale: 0.8,', 'scale: ([\\d.]+)')).toBe(0.8);
  });

  test('returns null when the pattern misses', () => {
    expect(probeNumber('nothing here', '(\\d+)px')).toBeNull();
  });
});

describe('checkCssNumberMirror', () => {
  const mirror: CssNumberMirror = {
    name: 'header',
    constant: { file: 'c.ts', pattern: 'export const HEADER = (\\d+)' },
    subtract: { file: 'c.ts', pattern: 'export const LINE = (\\d+)' },
    css: {
      file: 's.css',
      anchor: '[data-header] {',
      pattern: 'min-height:\\s*calc\\(1lh \\+ (\\d+)px\\)',
    },
  };
  const constants = 'export const HEADER = 44;\nexport const LINE = 20;';

  test('constant − subtract matching the CSS number passes', () => {
    const files = {
      'c.ts': constants,
      's.css': '[data-header] {\n  min-height: calc(1lh + 24px);\n}',
    };
    expect(checkCssNumberMirror(mirror, reader(files))).toEqual([]);
  });

  test('a drifted CSS number fails naming both files', () => {
    const files = {
      'c.ts': constants,
      's.css': '[data-header] {\n  min-height: calc(1lh + 32px);\n}',
    };
    const violations = checkCssNumberMirror(mirror, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('32');
    expect(violations[0]?.message).toContain('24');
  });

  test('the probe reads after the anchor, not a lookalike before it', () => {
    const files = {
      'c.ts': constants,
      's.css':
        '[data-other] { min-height: calc(1lh + 99px); }\n' +
        '[data-header] {\n  min-height: calc(1lh + 24px);\n}',
    };
    expect(checkCssNumberMirror(mirror, reader(files))).toEqual([]);
  });

  test('a missing anchor fails loud instead of passing silently', () => {
    const files = { 'c.ts': constants, 's.css': '.renamed { height: 1px; }' };
    const violations = checkCssNumberMirror(mirror, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('anchor');
  });

  test('numbers in TS doc comments cannot satisfy the constant probe', () => {
    const files = {
      // The real declaration is gone; only prose mentions the value.
      'c.ts': '/* HEADER = 44 (see const HEADER = 44) */',
      's.css': '[data-header] { min-height: calc(1lh + 24px); }',
    };
    const violations = checkCssNumberMirror(mirror, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('constant probe');
  });
});

describe('checkCssFallbackMirror', () => {
  const mirror: CssFallbackMirror = {
    name: 'line-height',
    constant: { file: 'c.ts', pattern: 'export const LINE = (\\d+)' },
    css: { file: 's.css', varName: '--x-line-height', unit: 'px' },
  };

  test('all-matching fallbacks pass', () => {
    const files = {
      'c.ts': 'export const LINE = 20;',
      's.css':
        'a { height: var(--x-line-height, 20px); }\n' +
        'b { height: calc(var(--x-line-height, 20px) + 8px); }',
    };
    expect(checkCssFallbackMirror(mirror, reader(files))).toEqual([]);
  });

  test('one stale fallback among many fails', () => {
    const files = {
      'c.ts': 'export const LINE = 20;',
      's.css':
        'a { height: var(--x-line-height, 20px); }\n' +
        'b { height: var(--x-line-height, 16px); }',
    };
    const violations = checkCssFallbackMirror(mirror, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('16px');
  });

  test('zero occurrences fail loud (a renamed variable must not pass)', () => {
    const files = { 'c.ts': 'export const LINE = 20;', 's.css': 'a { b: c; }' };
    const violations = checkCssFallbackMirror(mirror, reader(files));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('renamed');
  });
});

describe('constAliasTarget', () => {
  test('resolves a plain alias through annotation and comments', () => {
    const source = `
      /** Alias of the engine table. */
      export const CURRENCY_DECIMALS: Readonly<Record<string, number>> =
        DEFAULT_CURRENCY_EXPONENTS;
    `;
    expect(constAliasTarget(source, 'CURRENCY_DECIMALS')).toBe(
      'DEFAULT_CURRENCY_EXPONENTS'
    );
  });

  test('returns null for a literal (non-alias) initializer', () => {
    expect(
      constAliasTarget(
        'export const CURRENCY_DECIMALS = { JPY: 0 };',
        'CURRENCY_DECIMALS'
      )
    ).toBeNull();
  });
});

describe('MIRROR_REGISTRY shape', () => {
  test('every entry has at least one mirror distinct from its source', () => {
    for (const entry of MIRROR_REGISTRY) {
      expect(entry.mirrors.length).toBeGreaterThan(0);
      for (const mirror of entry.mirrors) {
        expect(
          mirror.file === entry.sourceOfTruth.file &&
            mirror.symbol === entry.sourceOfTruth.symbol
        ).toBe(false);
      }
    }
  });

  test('the currency table — the incident that motivated the guard — is registered', () => {
    const entry = MIRROR_REGISTRY.find(
      (e) => e.name === 'currency-exponent-table'
    );
    expect(entry).toBeDefined();
    expect(entry?.sourceOfTruth.file).toContain('ledger-core');
    expect(entry?.mirrors.map((m) => m.file).join()).toContain('journals');
    expect(entry?.mirrors.map((m) => m.file).join()).toContain('importers');
  });
});
