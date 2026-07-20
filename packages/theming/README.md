# @cynco/theming

Docs: <https://ledger.cynco.dev/docs/theming> · npm:
[`@cynco/theming`](https://www.npmjs.com/package/@cynco/theming)

Runtime theming for Cynco ledger UIs: a framework-agnostic theme controller
(light / dark / system with OS-preference tracking), pluggable persistence, DOM
application helpers, and a React hook. Pairs with the role sets and CSS variable
convention from [`@cynco/theme`](../theme) that `@cynco/journals` and
`@cynco/accounts` consume.

## Quickstart (vanilla)

```ts
import {
  connectThemeController,
  createThemeController,
  defaultCatalog,
} from '@cynco/theming';

const controller = createThemeController({
  catalog: defaultCatalog,
  storageKey: 'my-app-theme', // persists the selection in localStorage
});

// Applies `--journals-theme-*` / `--accounts-theme-*` variables plus a
// `color-scheme` pin to the element, now and on every change.
const disconnect = connectThemeController(
  controller,
  document.getElementById('app')!
);

controller.setMode('dark'); // 'light' | 'dark' | 'system'
controller.setTheme('darkSoft'); // assigns to the slot the theme belongs to
```

`setTheme` records the choice for that theme's scheme slot (a light theme name
and a dark theme name are kept independently), so switching modes — or an OS
flip while in `system` mode — always lands on the right theme.

## Quickstart (React)

```tsx
import { createThemeController, defaultCatalog } from '@cynco/theming';
import { useThemeController } from '@cynco/theming/react';

const controller = createThemeController({ catalog: defaultCatalog });

function ThemePicker() {
  const { mode, themeName, resolvedScheme, catalog } =
    useThemeController(controller);
  return (
    <select
      value={themeName}
      onChange={(event) => controller.setTheme(event.target.value)}
    >
      {catalog.list().map((entry) => (
        <option key={entry.name} value={entry.name}>
          {entry.label}
        </option>
      ))}
    </select>
  );
}
```

The hook is a pure `useSyncExternalStore` wrapper with no state of its own;
React is an optional peer dependency required only by the `/react` entry.

## SSR

The controller is SSR-safe: no `window`, `matchMedia`, or `localStorage` access
happens at module scope, and every browser access is guarded. On the server (or
any headless runtime) `system` mode resolves to `'light'` and persistence
no-ops; the client re-resolves against the real OS preference and stored
selection on hydration. Serialize `themeToCSSVariables(prefix, snapshot.roles)`
from `@cynco/theme` for server-rendered inline styles if needed.

## Persistence

Pass `storageKey` for the built-in adapter: one localStorage JSON entry holding
only the selection names — `{ mode, light, dark }` — never resolved role
objects, so stored data can't go stale against a newer catalog. Corrupt JSON,
unknown theme names, or unavailable storage all degrade to the catalog defaults;
nothing throws at runtime.

For custom layouts, pass a `ThemePersistence` adapter instead (it takes
precedence over `storageKey`):

```ts
const controller = createThemeController({
  catalog: defaultCatalog,
  persistence: {
    load: () => readSelectionFromCookie(),
    save: (selection) => writeSelectionToCookie(selection),
  },
});
```

## Catalog customization

`defaultCatalog` wraps every `@cynco/theme` role set (light, dark, soft,
colorblind-safe, and tritan-safe variants). Build your own with
`createThemeCatalog`:

```ts
import { createThemeCatalog } from '@cynco/theming';
import { dark, light } from '@cynco/theme';

const catalog = createThemeCatalog(
  [
    { name: 'day', label: 'Day', scheme: 'light', roles: light },
    { name: 'night', label: 'Night', scheme: 'dark', roles: dark },
  ],
  { light: 'day', dark: 'night' }
);
```

Catalog construction is the one deliberate exception to graceful degradation:
duplicate names, unknown default names, or a default pointing at the wrong
scheme are programmer errors and throw with a clear message at creation time.

## applyThemeToElement contract

```ts
applyThemeToElement(element, controller.getSnapshot(), {
  prefixes: ['journals', 'accounts'], // the default
});
```

- Sets `--<prefix>-theme-<group>-<token>` inline custom properties for each
  prefix (via `@cynco/theme`'s `themeToCSSVariables`) and pins the element's
  inline `color-scheme` to the resolved scheme — the pin lives in the outer
  tree, so it beats the components' shadow `:host` rule.
- Tracks the properties it applied per element and removes stale ones on the
  next apply, so switching themes never leaves old variables behind.
- Only touches `element.style.setProperty` / `removeProperty`.

`connectThemeController(controller, element, options?)` wires this up on
subscribe; its disconnect function unsubscribes but deliberately leaves the
applied variables in place — removing them would flash unthemed UI.

## License

MIT
