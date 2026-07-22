import { describe, expect, test } from 'bun:test';

import {
  checkCssFallbackMirror,
  checkCssNumberMirror,
  type CssFallbackMirror,
  type CssNumberMirror,
  probeNumber,
  type SourceReader,
  stripComments,
} from './assert-lockstep';

// Synthetic two-file workspace: a constants file and a stylesheet. Each
// suite mutates one side to prove the checker actually fails on drift (a
// lockstep guard that cannot go red is worse than none).
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
