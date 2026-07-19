/**
 * Minimal hand-rolled browser stubs for bun tests. The controller only
 * touches `matchMedia('(prefers-color-scheme: dark)')` and
 * `localStorage.getItem/setItem` through guarded lookups, so full jsdom is
 * unnecessary here — these stubs cover exactly that surface and restore the
 * previous globals on uninstall.
 */

export interface MatchMediaStub {
  /** Number of currently attached 'change' listeners. */
  listenerCount(): number;
  /** Flips the stubbed OS preference and fires attached listeners. */
  setPrefersDark(matches: boolean): void;
  uninstall(): void;
}

export function installMatchMedia(prefersDark: boolean): MatchMediaStub {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener(
      _type: string,
      listener: (event: { matches: boolean }) => void
    ): void {
      listeners.add(listener);
    },
    removeEventListener(
      _type: string,
      listener: (event: { matches: boolean }) => void
    ): void {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => mql,
  });
  return {
    listenerCount: () => listeners.size,
    setPrefersDark(matches: boolean): void {
      mql.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
    uninstall(): void {
      restoreGlobal('matchMedia', original);
    },
  };
}

export interface LocalStorageStub {
  /** Backing store, for asserting the exact persisted shape. */
  entries: Map<string, string>;
  uninstall(): void;
}

export function installLocalStorage(
  initial: Record<string, string> = {}
): LocalStorageStub {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return {
    entries,
    uninstall(): void {
      restoreGlobal('localStorage', original);
    },
  };
}

// Restores (or removes) a global overridden via defineProperty, so tests
// leave whatever the runtime originally provided.
function restoreGlobal(
  key: string,
  original: PropertyDescriptor | undefined
): void {
  if (original == null) {
    Reflect.deleteProperty(globalThis, key);
  } else {
    Object.defineProperty(globalThis, key, original);
  }
}
