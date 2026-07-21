import { describe, expect, test } from 'bun:test';

import { resolveAmountFormat } from '../src/utils/resolveAmountFormat';

// Boundary helper only: these tests run wherever the HOST would run it, so
// asserting against the runtime's ICU here is fine — the render-path tests
// never touch Intl. Only locales whose separators are stable across every
// ICU release in living memory are pinned exactly.
describe('resolveAmountFormat', () => {
  test('en-US resolves to the default comma-dot shape', () => {
    expect(resolveAmountFormat('en-US')).toEqual({
      decimal: '.',
      group: ',',
      groupSizes: [3],
    });
  });

  test('de-DE resolves to dot-comma', () => {
    expect(resolveAmountFormat('de-DE')).toEqual({
      decimal: ',',
      group: '.',
      groupSizes: [3],
    });
  });

  test('en-IN resolves Indian lakh/crore grouping', () => {
    expect(resolveAmountFormat('en-IN')).toEqual({
      decimal: '.',
      group: ',',
      groupSizes: [3, 2],
    });
  });

  test('unknown locales degrade to a usable descriptor instead of throwing', () => {
    const format = resolveAmountFormat('zz-invalid-tag-!!!');
    expect(typeof format.decimal).toBe('string');
    expect(Array.isArray([...format.groupSizes])).toBe(true);
  });
});
