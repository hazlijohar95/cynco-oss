import { describe, expect, test } from 'bun:test';

import {
  getAccountLeafName,
  getAccountSegments,
  getAncestorAccountPaths,
  getParentAccountPath,
  isValidAccountPath,
} from '../src/accountPath';

describe('isValidAccountPath', () => {
  test('accepts canonical paths', () => {
    expect(isValidAccountPath('Assets')).toBe(true);
    expect(isValidAccountPath('Assets:Current:Cash-Maybank')).toBe(true);
    expect(isValidAccountPath('Liabilities:Current:SST-Payable')).toBe(true);
  });

  test('accepts unicode segment names', () => {
    expect(isValidAccountPath('Expenses:Makan Tengahari:Nasi-Lemak')).toBe(
      true
    );
    expect(isValidAccountPath('Expenses:食費:昼ご飯')).toBe(true);
  });

  test('rejects empty and delimiter-degenerate paths', () => {
    expect(isValidAccountPath('')).toBe(false);
    expect(isValidAccountPath(':')).toBe(false);
    expect(isValidAccountPath(':Assets')).toBe(false);
    expect(isValidAccountPath('Assets:')).toBe(false);
    expect(isValidAccountPath('Assets::Cash')).toBe(false);
    expect(isValidAccountPath('::')).toBe(false);
  });
});

describe('getAccountSegments', () => {
  test('splits canonical paths', () => {
    expect(getAccountSegments('Assets:Current:Cash')).toEqual([
      'Assets',
      'Current',
      'Cash',
    ]);
    expect(getAccountSegments('Assets')).toEqual(['Assets']);
  });

  test('degrades to empty array for invalid input', () => {
    expect(getAccountSegments('')).toEqual([]);
    expect(getAccountSegments('A::B')).toEqual([]);
  });
});

describe('getParentAccountPath', () => {
  test('returns the parent for nested paths', () => {
    expect(getParentAccountPath('Assets:Current:Cash')).toBe('Assets:Current');
    expect(getParentAccountPath('Assets:Current')).toBe('Assets');
  });

  test('returns null for top-level and invalid paths', () => {
    expect(getParentAccountPath('Assets')).toBeNull();
    expect(getParentAccountPath('')).toBeNull();
    expect(getParentAccountPath('Assets::Cash')).toBeNull();
  });
});

describe('getAncestorAccountPaths', () => {
  test('lists strict ancestors nearest-root first', () => {
    expect(getAncestorAccountPaths('Assets:Current:Cash')).toEqual([
      'Assets',
      'Assets:Current',
    ]);
  });

  test('empty for top-level and invalid paths', () => {
    expect(getAncestorAccountPaths('Assets')).toEqual([]);
    expect(getAncestorAccountPaths(':Assets')).toEqual([]);
  });
});

describe('getAccountLeafName', () => {
  test('returns the final segment', () => {
    expect(getAccountLeafName('Assets:Current:Cash-Maybank')).toBe(
      'Cash-Maybank'
    );
    expect(getAccountLeafName('Assets')).toBe('Assets');
  });

  test('returns the empty string for invalid paths', () => {
    expect(getAccountLeafName('')).toBe('');
    expect(getAccountLeafName('Assets:')).toBe('');
  });
});
