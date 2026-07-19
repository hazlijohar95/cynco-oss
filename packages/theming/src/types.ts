import type { Roles } from '@cynco/theme';

/**
 * The user-facing mode choice. 'system' follows the OS preference via
 * `prefers-color-scheme`; the other two pin a scheme explicitly.
 */
export type ColorMode = 'light' | 'dark' | 'system';

/**
 * A ColorMode collapsed against the OS preference: always concrete, never
 * 'system'. This is what drives `color-scheme` pins and theme-slot lookup.
 */
export type ResolvedColorScheme = 'light' | 'dark';

/**
 * The persisted selection: the mode plus the theme NAME chosen for each
 * scheme slot. Only names are ever stored — resolved role objects are
 * re-derived from the catalog on load, so persisted data can never go stale
 * against a newer catalog. Both slots are kept (not just the active theme)
 * so a system-mode OS flip restores the user's choice for either scheme.
 */
export interface ThemeSelection {
  mode: ColorMode;
  light: string;
  dark: string;
}

/**
 * Pluggable persistence for the selection. `load` returns the stored
 * selection or null when absent/unreadable; `save` writes it. Implementations
 * must guard their own browser access (the controller stays SSR-safe and
 * treats every failure as "no stored selection").
 */
export interface ThemePersistence {
  load(): ThemeSelection | null;
  save(selection: ThemeSelection): void;
}

/**
 * One selectable theme: a unique name (the persisted identifier), a
 * human-readable label for pickers, the scheme slot it belongs to, and the
 * @cynco/theme role set that renders it.
 */
export interface ThemeCatalogEntry {
  name: string;
  label: string;
  scheme: ResolvedColorScheme;
  roles: Roles;
}

/**
 * A frozen, validated set of selectable themes. Lookup by name returns null
 * for unknown names (graceful degradation for persisted/user input);
 * `defaultFor` always resolves because defaults are validated at creation.
 */
export interface ThemeCatalog {
  get(name: string): ThemeCatalogEntry | null;
  list(): readonly ThemeCatalogEntry[];
  defaultFor(scheme: ResolvedColorScheme): ThemeCatalogEntry;
}

/**
 * Options for createThemeController. `storageKey` enables the built-in
 * localStorage adapter (one JSON entry holding the ThemeSelection names);
 * a custom `persistence` adapter takes precedence over it.
 */
export interface ThemeControllerOptions {
  catalog: ThemeCatalog;
  /** Starting mode when nothing is persisted. Defaults to 'system'. */
  initialMode?: ColorMode;
  /** Starting theme name per scheme slot; unknown names fall back to the
   * catalog defaults instead of throwing. */
  initialTheme?: { light?: string; dark?: string };
  persistence?: ThemePersistence;
  storageKey?: string;
}

/**
 * The controller's published state: frozen and reference-stable until the
 * next change, as required by useSyncExternalStore. `themeName`/`roles` are
 * the ACTIVE theme for `resolvedScheme`; the catalog rides along so UIs can
 * render pickers from the same snapshot.
 */
export interface ThemeControllerSnapshot {
  mode: ColorMode;
  resolvedScheme: ResolvedColorScheme;
  themeName: string;
  roles: Roles;
  catalog: ThemeCatalog;
}
