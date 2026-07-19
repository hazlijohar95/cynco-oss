import type {
  ColorMode,
  ResolvedColorScheme,
  ThemeControllerOptions,
  ThemeControllerSnapshot,
  ThemePersistence,
  ThemeSelection,
} from './types';

/**
 * The framework-agnostic runtime theming store: owns the mode, the per-scheme
 * theme choice, persistence, and the OS-preference subscription. React binds
 * to it through @cynco/theming/react (useSyncExternalStore); vanilla hosts
 * subscribe directly or via connectThemeController.
 */
export interface ThemeController {
  /** Frozen, cached state — the same reference until something changes. */
  getSnapshot(): ThemeControllerSnapshot;
  subscribe(listener: () => void): () => void;
  setMode(mode: ColorMode): void;
  /**
   * Assigns a theme (by catalog name) to the scheme slot it belongs to; it
   * does not switch modes. Unknown names are a documented no-op — pickers
   * often feed persisted/user strings, and crashing the host over a stale
   * name would be worse than keeping the current theme.
   */
  setTheme(name: string): void;
  /** Detaches the prefers-color-scheme listener and drops all subscribers.
   * Safe to call on the server or more than once. */
  destroy(): void;
}

// Reads window.localStorage defensively: absent on the server, and access
// itself can throw in sandboxed iframes / private modes. Every failure is
// treated as "no storage" so theming never takes the host down.
function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage != null) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access denied — behave as if persistence is unavailable.
  }
  return null;
}

// The built-in persistence adapter behind `storageKey`: one JSON entry
// holding ONLY the selection names ({ mode, light, dark }), never resolved
// role objects. Corrupt or partial values load as null so the controller
// falls back to its defaults instead of throwing.
function createLocalStoragePersistence(storageKey: string): ThemePersistence {
  return {
    load(): ThemeSelection | null {
      const storage = getLocalStorage();
      if (storage == null) return null;
      try {
        const raw = storage.getItem(storageKey);
        if (raw == null) return null;
        const parsed = JSON.parse(raw) as Partial<ThemeSelection> | null;
        if (parsed == null || typeof parsed !== 'object') return null;
        if (!isColorMode(parsed.mode)) return null;
        if (typeof parsed.light !== 'string') return null;
        if (typeof parsed.dark !== 'string') return null;
        return { mode: parsed.mode, light: parsed.light, dark: parsed.dark };
      } catch {
        return null; // Corrupt JSON — treat as absent.
      }
    },
    save(selection: ThemeSelection): void {
      const storage = getLocalStorage();
      try {
        storage?.setItem(storageKey, JSON.stringify(selection));
      } catch {
        // Quota/access errors are non-fatal for theming.
      }
    },
  };
}

// Guarded matchMedia lookup: returns null on the server or when the API is
// unavailable, which makes 'system' resolve to the light default until a
// client environment can report the real preference.
function getDarkSchemeQuery(): MediaQueryList | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.matchMedia === 'function'
    ) {
      return globalThis.matchMedia('(prefers-color-scheme: dark)');
    }
  } catch {
    // No matchMedia — fall through to the headless light default.
  }
  return null;
}

// Runtime guard for persisted data: custom persistence adapters may hand back
// anything, so the mode is validated like external input.
function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function createThemeController(
  options: ThemeControllerOptions
): ThemeController {
  const { catalog } = options;

  // Validates a candidate theme name for a scheme slot: it must exist in the
  // catalog AND belong to that scheme. Anything else (typo, stale persisted
  // name, theme removed from the catalog) degrades to the catalog default —
  // never a throw, because this path is fed by stored data.
  function validThemeNameFor(
    scheme: ResolvedColorScheme,
    candidate: string | undefined
  ): string {
    if (candidate != null) {
      const entry = catalog.get(candidate);
      if (entry != null && entry.scheme === scheme) return entry.name;
    }
    return catalog.defaultFor(scheme).name;
  }

  // A custom adapter wins; otherwise `storageKey` enables the built-in
  // localStorage adapter; otherwise persistence is disabled entirely.
  const persistence: ThemePersistence | null =
    options.persistence ??
    (options.storageKey != null
      ? createLocalStoragePersistence(options.storageKey)
      : null);

  // Persistence is loaded exactly once, at creation; loaded values win over
  // the initial* options, and every field degrades independently.
  const persisted = persistence?.load() ?? null;

  let mode: ColorMode = isColorMode(persisted?.mode)
    ? persisted.mode
    : (options.initialMode ?? 'system');
  let lightName = validThemeNameFor(
    'light',
    persisted?.light ?? options.initialTheme?.light
  );
  let darkName = validThemeNameFor(
    'dark',
    persisted?.dark ?? options.initialTheme?.dark
  );

  const listeners = new Set<() => void>();
  let snapshot: ThemeControllerSnapshot | null = null;
  let destroyed = false;

  // The prefers-color-scheme subscription is attached ONLY while mode is
  // 'system' (and detached on destroy): pinned modes ignore the OS, so a live
  // listener there would be a leak that also fires useless notifications.
  let mediaQuery: MediaQueryList | null = null;
  const onMediaChange = (): void => {
    if (mode !== 'system') return;
    const next: ResolvedColorScheme =
      mediaQuery?.matches === true ? 'dark' : 'light';
    if (next === resolvedScheme) return;
    resolvedScheme = next;
    // The stored selection (mode + names) did not change, so no persist.
    publish();
  };
  function attachMediaListener(): void {
    if (mediaQuery != null) return;
    mediaQuery = getDarkSchemeQuery();
    mediaQuery?.addEventListener('change', onMediaChange);
  }
  function detachMediaListener(): void {
    mediaQuery?.removeEventListener('change', onMediaChange);
    mediaQuery = null;
  }

  // Collapses the mode to the concrete scheme that applies right now,
  // resolving 'system' against the OS preference (light when headless).
  function resolveScheme(current: ColorMode): ResolvedColorScheme {
    if (current !== 'system') return current;
    const query = mediaQuery ?? getDarkSchemeQuery();
    return query?.matches === true ? 'dark' : 'light';
  }

  if (mode === 'system') attachMediaListener();
  let resolvedScheme: ResolvedColorScheme = resolveScheme(mode);

  // Invalidates the cached snapshot and notifies subscribers. Iterates a copy
  // so a listener unsubscribing (or subscribing) mid-notify is safe.
  function publish(): void {
    snapshot = null;
    for (const listener of [...listeners]) listener();
  }

  function persist(): void {
    persistence?.save({ mode, light: lightName, dark: darkName });
  }

  return {
    getSnapshot(): ThemeControllerSnapshot {
      // Rebuilt lazily after each change and frozen: useSyncExternalStore
      // requires a stable reference between changes, and freezing guarantees
      // subscribers cannot mutate shared state.
      if (snapshot == null) {
        const activeName = resolvedScheme === 'dark' ? darkName : lightName;
        const entry =
          catalog.get(activeName) ?? catalog.defaultFor(resolvedScheme);
        snapshot = Object.freeze({
          mode,
          resolvedScheme,
          themeName: entry.name,
          roles: entry.roles,
          catalog,
        });
      }
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMode(nextMode: ColorMode): void {
      if (destroyed || nextMode === mode) return;
      mode = nextMode;
      // Attach before resolving so 'system' reads the live query it will
      // keep listening to.
      if (mode === 'system') {
        attachMediaListener();
      } else {
        detachMediaListener();
      }
      resolvedScheme = resolveScheme(mode);
      persist();
      publish();
    },
    setTheme(name: string): void {
      if (destroyed) return;
      const entry = catalog.get(name);
      if (entry == null) return; // Unknown name: documented no-op.
      if (entry.scheme === 'dark') {
        if (darkName === name) return;
        darkName = name;
      } else {
        if (lightName === name) return;
        lightName = name;
      }
      persist();
      publish();
    },
    destroy(): void {
      destroyed = true;
      detachMediaListener();
      listeners.clear();
    },
  };
}
