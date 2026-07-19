import { dark, light } from '@cynco/theme';
import { describe, expect, test } from 'bun:test';

import { connectThemeController } from '../src/connectThemeController';
import { createThemeController } from '../src/createThemeController';
import { defaultCatalog } from '../src/defaultCatalog';
import { makeFakeElement } from './fakeElement';

describe('connectThemeController', () => {
  test('applies immediately and re-applies on every controller change', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    const { element, styles } = makeFakeElement();
    connectThemeController(controller, element);

    expect(styles.get('--journals-theme-bg-editor')).toBe(light.bg.editor);
    expect(styles.get('color-scheme')).toBe('light');

    controller.setMode('dark');
    expect(styles.get('--journals-theme-bg-editor')).toBe(dark.bg.editor);
    expect(styles.get('--accounts-theme-bg-editor')).toBe(dark.bg.editor);
    expect(styles.get('color-scheme')).toBe('dark');
  });

  test('disconnect stops updates but leaves the applied theme in place', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'dark',
    });
    const { element, styles } = makeFakeElement();
    const disconnect = connectThemeController(controller, element);
    disconnect();

    controller.setMode('light');
    // Still themed with the last applied (dark) values: removal on
    // disconnect would flash unthemed UI, so vars are deliberately kept.
    expect(styles.get('--journals-theme-bg-editor')).toBe(dark.bg.editor);
    expect(styles.get('color-scheme')).toBe('dark');
  });
});
