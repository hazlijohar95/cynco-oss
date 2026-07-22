import { journalsThemeVariables } from '@cynco/journals';
import type { Roles } from '@cynco/theme';

// Zips a light and a dark role set into one `--journals-theme-*` variable
// map where every value is a `light-dark()` pair, so the page's color
// scheme picks the side — the exact mechanism the package's built-in
// defaults use. Shared by the theming docs demos.
export function mergedJournalsThemeVariables(
  lightRoles: Roles,
  darkRoles: Roles
): Record<string, string> {
  const lightVariables = journalsThemeVariables(lightRoles);
  const darkVariables = journalsThemeVariables(darkRoles);
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(lightVariables)) {
    merged[name] = `light-dark(${value}, ${darkVariables[name]})`;
  }
  return merged;
}
