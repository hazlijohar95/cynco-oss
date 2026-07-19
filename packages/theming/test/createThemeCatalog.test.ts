import { dark, light } from '@cynco/theme';
import { describe, expect, test } from 'bun:test';

import { createThemeCatalog } from '../src/createThemeCatalog';
import type { ThemeCatalogEntry } from '../src/types';

const LIGHT_ENTRY: ThemeCatalogEntry = {
  name: 'day',
  label: 'Day',
  scheme: 'light',
  roles: light,
};
const DARK_ENTRY: ThemeCatalogEntry = {
  name: 'night',
  label: 'Night',
  scheme: 'dark',
  roles: dark,
};

function makeCatalog() {
  return createThemeCatalog([LIGHT_ENTRY, DARK_ENTRY], {
    light: 'day',
    dark: 'night',
  });
}

describe('createThemeCatalog', () => {
  test('throws on duplicate theme names', () => {
    expect(() =>
      createThemeCatalog([LIGHT_ENTRY, { ...DARK_ENTRY, name: 'day' }], {
        light: 'day',
        dark: 'day',
      })
    ).toThrow('duplicate theme name "day"');
  });

  test('throws when a default name is not in the catalog', () => {
    expect(() =>
      createThemeCatalog([LIGHT_ENTRY, DARK_ENTRY], {
        light: 'missing',
        dark: 'night',
      })
    ).toThrow('default light theme "missing" is not in the catalog');
    expect(() =>
      createThemeCatalog([LIGHT_ENTRY, DARK_ENTRY], {
        light: 'day',
        dark: 'missing',
      })
    ).toThrow('default dark theme "missing" is not in the catalog');
  });

  test('throws when a default points at the wrong scheme', () => {
    expect(() =>
      createThemeCatalog([LIGHT_ENTRY, DARK_ENTRY], {
        light: 'night',
        dark: 'night',
      })
    ).toThrow('default light theme "night" has scheme "dark"');
  });

  test('get returns the entry by name, null for unknown names', () => {
    const catalog = makeCatalog();
    expect(catalog.get('day')?.label).toBe('Day');
    expect(catalog.get('day')?.roles).toBe(light);
    expect(catalog.get('nope')).toBeNull();
  });

  test('list returns every entry in insertion order', () => {
    const catalog = makeCatalog();
    expect(catalog.list().map((entry) => entry.name)).toEqual(['day', 'night']);
  });

  test('defaultFor resolves the validated per-scheme defaults', () => {
    const catalog = makeCatalog();
    expect(catalog.defaultFor('light').name).toBe('day');
    expect(catalog.defaultFor('dark').name).toBe('night');
  });

  test('catalog, list, and entries are frozen', () => {
    const catalog = makeCatalog();
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.list())).toBe(true);
    expect(Object.isFrozen(catalog.get('day'))).toBe(true);
  });
});
