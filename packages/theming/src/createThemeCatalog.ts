import type {
  ResolvedColorScheme,
  ThemeCatalog,
  ThemeCatalogEntry,
} from './types';

// Builds the frozen catalog a controller selects themes from. Unlike the
// runtime paths (persistence load, setTheme), which degrade gracefully on
// unknown names, catalog construction THROWS on duplicate names or defaults
// that don't resolve: the entries and defaults are authored in code, so a bad
// catalog is a programmer error and failing loudly at boot beats silently
// rendering the wrong theme (same deliberate exception to graceful
// degradation as assertSafeMinorUnits in the data layer).
export function createThemeCatalog(
  entries: readonly ThemeCatalogEntry[],
  defaults: { light: string; dark: string }
): ThemeCatalog {
  const byName = new Map<string, ThemeCatalogEntry>();
  for (const entry of entries) {
    if (byName.has(entry.name)) {
      throw new Error(
        `createThemeCatalog: duplicate theme name "${entry.name}"`
      );
    }
    byName.set(entry.name, Object.freeze({ ...entry }));
  }

  assertDefault(byName, 'light', defaults.light);
  assertDefault(byName, 'dark', defaults.dark);

  const list = Object.freeze([...byName.values()]);

  return Object.freeze({
    get(name: string): ThemeCatalogEntry | null {
      return byName.get(name) ?? null;
    },
    list(): readonly ThemeCatalogEntry[] {
      return list;
    },
    defaultFor(scheme: ResolvedColorScheme): ThemeCatalogEntry {
      // Non-null by construction: both defaults were asserted above.
      const entry = byName.get(
        scheme === 'dark' ? defaults.dark : defaults.light
      );
      if (entry == null) {
        throw new Error(`createThemeCatalog: missing default for "${scheme}"`);
      }
      return entry;
    },
  });
}

// A default must name a catalog entry AND live in the scheme slot it is the
// default for — a light default pointing at a dark theme would make every
// fallback path flip the user's scheme.
function assertDefault(
  byName: Map<string, ThemeCatalogEntry>,
  scheme: ResolvedColorScheme,
  name: string
): void {
  const entry = byName.get(name);
  if (entry == null) {
    throw new Error(
      `createThemeCatalog: default ${scheme} theme "${name}" is not in the catalog`
    );
  }
  if (entry.scheme !== scheme) {
    throw new Error(
      `createThemeCatalog: default ${scheme} theme "${name}" has scheme "${entry.scheme}"`
    );
  }
}
