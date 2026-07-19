import { themeToCSSVariables } from '@cynco/theme';

import type { ThemeControllerSnapshot } from './types';

/**
 * Options for applyThemeToElement/connectThemeController. Each prefix expands
 * to one component family's variable namespace (`--<prefix>-theme-*` — the
 * convention @cynco/theme's themeToCSSVariables produces and
 * journalsThemeVariables/accountsThemeVariables wrap). Defaults to both
 * ledger component families.
 */
export interface ApplyThemeOptions {
  prefixes?: readonly string[];
}

const DEFAULT_PREFIXES: readonly string[] = ['journals', 'accounts'];

// Property names applied per element, so a later apply can remove anything
// the new theme no longer sets. Today every role set shares one shape, but a
// custom catalog (or a future role group) must not leave theme A's variables
// behind under theme B. WeakMap keeps disconnected elements collectable.
const appliedProperties = new WeakMap<HTMLElement, Set<string>>();

// Writes a snapshot's theme onto an element as inline styles: the
// `--<prefix>-theme-*` custom properties every component under it reads
// (reusing @cynco/theme's themeToCSSVariables — the single source of the
// naming convention), plus a `color-scheme` pin to the resolved scheme. The
// inline pin lives in the outer tree, so it beats the components' shadow
// `:host { color-scheme: light dark }` rule and forces light-dark() to the
// controller's scheme instead of the OS preference.
export function applyThemeToElement(
  element: HTMLElement,
  snapshot: ThemeControllerSnapshot,
  options: ApplyThemeOptions = {}
): void {
  const prefixes = options.prefixes ?? DEFAULT_PREFIXES;

  const next: Record<string, string> = {};
  for (const prefix of prefixes) {
    Object.assign(next, themeToCSSVariables(prefix, snapshot.roles));
  }

  // Remove stale properties from the previous apply before writing the new
  // set, so switching themes (or prefixes) never leaves orphaned variables.
  const previous = appliedProperties.get(element);
  if (previous != null) {
    for (const property of previous) {
      if (!Object.hasOwn(next, property)) {
        element.style.removeProperty(property);
      }
    }
  }

  const applied = new Set<string>();
  for (const [property, value] of Object.entries(next)) {
    element.style.setProperty(property, value);
    applied.add(property);
  }
  appliedProperties.set(element, applied);

  // Not tracked in `applied`: the pin is always rewritten, never stale.
  element.style.setProperty('color-scheme', snapshot.resolvedScheme);
}
