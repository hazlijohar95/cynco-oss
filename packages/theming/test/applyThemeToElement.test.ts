import { dark, light, lightSoft } from '@cynco/theme';
import { describe, expect, test } from 'bun:test';

import { applyThemeToElement } from '../src/applyThemeToElement';
import { defaultCatalog } from '../src/defaultCatalog';
import type { ThemeControllerSnapshot } from '../src/types';
import { makeFakeElement } from './fakeElement';

function makeSnapshot(
  overrides: Partial<ThemeControllerSnapshot> = {}
): ThemeControllerSnapshot {
  return {
    mode: 'light',
    resolvedScheme: 'light',
    themeName: 'light',
    roles: light,
    catalog: defaultCatalog,
    ...overrides,
  };
}

describe('applyThemeToElement', () => {
  test('sets variables for both default prefixes plus the color-scheme pin', () => {
    const { element, styles } = makeFakeElement();
    applyThemeToElement(element, makeSnapshot());

    expect(styles.get('--journals-theme-bg-editor')).toBe(light.bg.editor);
    expect(styles.get('--accounts-theme-bg-editor')).toBe(light.bg.editor);
    // Camel-cased tokens kebab-case exactly like themeToCSSVariables does.
    expect(styles.get('--journals-theme-ledger-balance-negative')).toBe(
      light.ledger.balanceNegative
    );
    expect(styles.get('color-scheme')).toBe('light');
  });

  test('re-applying a different theme updates values and the pin', () => {
    const { element, styles } = makeFakeElement();
    applyThemeToElement(element, makeSnapshot());
    applyThemeToElement(
      element,
      makeSnapshot({ resolvedScheme: 'dark', themeName: 'dark', roles: dark })
    );

    expect(styles.get('--journals-theme-bg-editor')).toBe(dark.bg.editor);
    expect(styles.get('--accounts-theme-fg-base')).toBe(dark.fg.base);
    expect(styles.get('color-scheme')).toBe('dark');
  });

  test('removes stale properties when the applied set shrinks', () => {
    const { element, styles } = makeFakeElement();
    applyThemeToElement(element, makeSnapshot());
    expect(styles.has('--accounts-theme-bg-editor')).toBe(true);

    // Narrowing the prefixes must strip the properties the previous apply
    // set — nothing from the earlier theme may linger.
    applyThemeToElement(
      element,
      makeSnapshot({ themeName: 'lightSoft', roles: lightSoft }),
      { prefixes: ['journals'] }
    );
    expect(styles.has('--accounts-theme-bg-editor')).toBe(false);
    expect(styles.get('--journals-theme-bg-editor')).toBe(lightSoft.bg.editor);
    expect(styles.get('color-scheme')).toBe('light');
  });

  test('custom prefixes produce that namespace only', () => {
    const { element, styles } = makeFakeElement();
    applyThemeToElement(element, makeSnapshot(), { prefixes: ['demo'] });

    expect(styles.get('--demo-theme-bg-editor')).toBe(light.bg.editor);
    expect(styles.has('--journals-theme-bg-editor')).toBe(false);
    expect(styles.has('--accounts-theme-bg-editor')).toBe(false);
  });

  test('tracks applied properties per element (no cross-element bleed)', () => {
    const first = makeFakeElement();
    const second = makeFakeElement();
    applyThemeToElement(first.element, makeSnapshot());
    applyThemeToElement(second.element, makeSnapshot(), {
      prefixes: ['journals'],
    });

    // Styling the second element with a narrower set must not remove
    // anything from the first element's inline styles.
    expect(first.styles.has('--accounts-theme-bg-editor')).toBe(true);
    expect(second.styles.has('--accounts-theme-bg-editor')).toBe(false);

    // Narrowing the FIRST element afterwards must remove exactly its own
    // stale properties — proving stale-removal consults the per-element
    // tracked set, not state left behind by the other element's apply.
    applyThemeToElement(first.element, makeSnapshot(), {
      prefixes: ['journals'],
    });
    expect(first.styles.has('--accounts-theme-bg-editor')).toBe(false);
    expect(first.styles.has('--journals-theme-bg-editor')).toBe(true);
    expect(second.styles.has('--journals-theme-bg-editor')).toBe(true);
  });
});
