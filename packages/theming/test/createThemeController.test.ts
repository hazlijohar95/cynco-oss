import { afterEach, describe, expect, test } from 'bun:test';

import { createThemeController } from '../src/createThemeController';
import { defaultCatalog } from '../src/defaultCatalog';
import type { ThemePersistence, ThemeSelection } from '../src/types';
import {
  installLocalStorage,
  installMatchMedia,
  type LocalStorageStub,
  type MatchMediaStub,
} from './browserStubs';

let matchMediaStub: MatchMediaStub | undefined;
let localStorageStub: LocalStorageStub | undefined;

afterEach(() => {
  matchMediaStub?.uninstall();
  matchMediaStub = undefined;
  localStorageStub?.uninstall();
  localStorageStub = undefined;
});

describe('createThemeController — initial snapshot', () => {
  test('defaults: system mode resolves to light when headless (no matchMedia)', () => {
    const controller = createThemeController({ catalog: defaultCatalog });
    const snapshot = controller.getSnapshot();
    expect(snapshot.mode).toBe('system');
    expect(snapshot.resolvedScheme).toBe('light');
    expect(snapshot.themeName).toBe('light');
    expect(snapshot.roles).toBe(defaultCatalog.defaultFor('light').roles);
    expect(snapshot.catalog).toBe(defaultCatalog);
  });

  test('initialMode pins the scheme and picks that slot default', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'dark',
    });
    expect(controller.getSnapshot().resolvedScheme).toBe('dark');
    expect(controller.getSnapshot().themeName).toBe('dark');
  });

  test('initialTheme selects per-scheme names; unknown names fall back to defaults', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
      initialTheme: { light: 'lightSoft', dark: 'not-a-theme' },
    });
    expect(controller.getSnapshot().themeName).toBe('lightSoft');
    controller.setMode('dark');
    expect(controller.getSnapshot().themeName).toBe('dark');
  });

  test('snapshot is frozen', () => {
    const controller = createThemeController({ catalog: defaultCatalog });
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
  });
});

describe('createThemeController — snapshot reference semantics', () => {
  test('same reference until a change, new reference after', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    const first = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(first);

    controller.setMode('dark');
    const second = controller.getSnapshot();
    expect(second).not.toBe(first);
    expect(controller.getSnapshot()).toBe(second);
  });

  test('no-op setMode/setTheme keep the reference and stay silent', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });
    const before = controller.getSnapshot();
    controller.setMode('light'); // already light
    controller.setTheme('light'); // already the light slot choice
    controller.setTheme('not-a-theme'); // unknown: documented no-op
    expect(controller.getSnapshot()).toBe(before);
    expect(notifications).toBe(0);
  });
});

describe('createThemeController — setMode / setTheme', () => {
  test('setTheme applies to the scheme the theme belongs to', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    // Choosing a dark theme while light is active does not switch the view…
    controller.setTheme('darkSoft');
    expect(controller.getSnapshot().themeName).toBe('light');
    // …but the dark slot remembers it for the next dark activation.
    controller.setMode('dark');
    expect(controller.getSnapshot().themeName).toBe('darkSoft');
    expect(controller.getSnapshot().roles).toBe(
      defaultCatalog.get('darkSoft')?.roles ??
        defaultCatalog.defaultFor('dark').roles
    );
  });

  test('subscribe fires on change and unsubscribe stops notifications', () => {
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => {
      notifications += 1;
    });
    controller.setTheme('lightSoft');
    expect(notifications).toBe(1);
    unsubscribe();
    controller.setMode('dark');
    expect(notifications).toBe(1);
  });
});

describe('createThemeController — system mode tracking', () => {
  test('system mode reads the stubbed OS preference and follows flips', () => {
    matchMediaStub = installMatchMedia(true);
    const controller = createThemeController({ catalog: defaultCatalog });
    expect(controller.getSnapshot().resolvedScheme).toBe('dark');
    expect(controller.getSnapshot().themeName).toBe('dark');
    expect(matchMediaStub.listenerCount()).toBe(1);

    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });
    matchMediaStub.setPrefersDark(false);
    expect(notifications).toBe(1);
    expect(controller.getSnapshot().resolvedScheme).toBe('light');
    expect(controller.getSnapshot().roles).toBe(
      defaultCatalog.defaultFor('light').roles
    );
  });

  test('listener is attached only while in system mode', () => {
    matchMediaStub = installMatchMedia(false);
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
    });
    // Pinned mode at creation: no listener.
    expect(matchMediaStub.listenerCount()).toBe(0);

    controller.setMode('system');
    expect(matchMediaStub.listenerCount()).toBe(1);

    controller.setMode('dark');
    expect(matchMediaStub.listenerCount()).toBe(0);
    // An OS flip while pinned changes nothing.
    matchMediaStub.setPrefersDark(true);
    expect(controller.getSnapshot().resolvedScheme).toBe('dark');
    expect(controller.getSnapshot().mode).toBe('dark');
  });

  test('destroy detaches the listener and deadens the controller', () => {
    matchMediaStub = installMatchMedia(false);
    const controller = createThemeController({ catalog: defaultCatalog });
    expect(matchMediaStub.listenerCount()).toBe(1);
    controller.destroy();
    expect(matchMediaStub.listenerCount()).toBe(0);
    // Mutations after destroy are ignored.
    const snapshot = controller.getSnapshot();
    controller.setMode('dark');
    expect(controller.getSnapshot()).toBe(snapshot);
    // Second destroy is safe.
    controller.destroy();
  });
});

describe('createThemeController — persistence', () => {
  test('storageKey persists only the selection names as one JSON entry', () => {
    localStorageStub = installLocalStorage();
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
      storageKey: 'demo-theme',
    });
    controller.setTheme('lightSoft');
    controller.setMode('dark');
    const raw = localStorageStub.entries.get('demo-theme');
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? '')).toEqual({
      mode: 'dark',
      light: 'lightSoft',
      dark: 'dark',
    });
  });

  test('a fresh controller rehydrates the persisted selection', () => {
    localStorageStub = installLocalStorage({
      'demo-theme': JSON.stringify({
        mode: 'dark',
        light: 'lightSoft',
        dark: 'darkTritan',
      }),
    });
    const controller = createThemeController({
      catalog: defaultCatalog,
      storageKey: 'demo-theme',
    });
    expect(controller.getSnapshot().mode).toBe('dark');
    expect(controller.getSnapshot().themeName).toBe('darkTritan');
    controller.setMode('light');
    expect(controller.getSnapshot().themeName).toBe('lightSoft');
  });

  test('corrupted JSON degrades to defaults', () => {
    localStorageStub = installLocalStorage({ 'demo-theme': '{not json' });
    const controller = createThemeController({
      catalog: defaultCatalog,
      initialMode: 'light',
      storageKey: 'demo-theme',
    });
    expect(controller.getSnapshot().mode).toBe('light');
    expect(controller.getSnapshot().themeName).toBe('light');
  });

  test('unknown persisted theme names degrade to the catalog defaults', () => {
    localStorageStub = installLocalStorage({
      'demo-theme': JSON.stringify({
        mode: 'dark',
        light: 'deleted-theme',
        dark: 'also-gone',
      }),
    });
    const controller = createThemeController({
      catalog: defaultCatalog,
      storageKey: 'demo-theme',
    });
    expect(controller.getSnapshot().mode).toBe('dark');
    expect(controller.getSnapshot().themeName).toBe('dark');
    controller.setMode('light');
    expect(controller.getSnapshot().themeName).toBe('light');
  });

  test('custom ThemePersistence adapter round-trips and wins over storageKey', () => {
    localStorageStub = installLocalStorage();
    let stored: ThemeSelection | null = {
      mode: 'dark',
      light: 'lightCvd',
      dark: 'darkCvd',
    };
    const saves: ThemeSelection[] = [];
    const persistence: ThemePersistence = {
      load: () => stored,
      save(selection) {
        stored = selection;
        saves.push(selection);
      },
    };
    const controller = createThemeController({
      catalog: defaultCatalog,
      persistence,
      storageKey: 'ignored-key',
    });
    expect(controller.getSnapshot().mode).toBe('dark');
    expect(controller.getSnapshot().themeName).toBe('darkCvd');

    controller.setMode('light');
    expect(saves.at(-1)).toEqual({
      mode: 'light',
      light: 'lightCvd',
      dark: 'darkCvd',
    });
    // The built-in adapter never ran.
    expect(localStorageStub.entries.size).toBe(0);
  });

  test('custom adapter returning a garbage mode degrades to initialMode', () => {
    const persistence: ThemePersistence = {
      load: () =>
        ({
          mode: 'sepia',
          light: 'light',
          dark: 'dark',
        }) as unknown as ThemeSelection,
      save() {},
    };
    const controller = createThemeController({
      catalog: defaultCatalog,
      persistence,
      initialMode: 'dark',
    });
    expect(controller.getSnapshot().mode).toBe('dark');
  });
});
