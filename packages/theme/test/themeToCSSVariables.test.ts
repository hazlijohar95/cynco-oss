import { describe, expect, test } from 'bun:test';

import { dark, darkSoft, light, lightSoft } from '../src/roles';
import { themeToCSSVariables } from '../src/themeToCSSVariables';

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8}|[0-9a-f]{3})$/i;

describe('themeToCSSVariables', () => {
  test('flattens roles into prefixed custom properties', () => {
    const variables = themeToCSSVariables('journals', dark);
    expect(variables['--journals-theme-bg-editor']).toBe('#0a0a0a');
    expect(variables['--journals-theme-accent-primary']).toBe('#009fff');
    expect(variables['--journals-theme-ledger-debit']).toBe('#5ecc71');
    expect(variables['--journals-theme-ledger-credit']).toBe('#ff6762');
  });

  test('kebab-cases multi-word token names', () => {
    const variables = themeToCSSVariables('journals', dark);
    expect(variables['--journals-theme-ledger-balance-negative']).toBeDefined();
    expect(
      variables['--journals-theme-border-indent-guide-active']
    ).toBeDefined();
  });

  test('every role value in every built-in theme is a hex color', () => {
    for (const roles of [dark, darkSoft, light, lightSoft]) {
      for (const value of Object.values(themeToCSSVariables('t', roles))) {
        expect(value).toMatch(HEX_COLOR);
      }
    }
  });

  test('all built-in themes expose an identical variable set', () => {
    const keys = Object.keys(themeToCSSVariables('t', dark)).sort();
    for (const roles of [darkSoft, light, lightSoft]) {
      expect(Object.keys(themeToCSSVariables('t', roles)).sort()).toEqual(keys);
    }
  });
});
