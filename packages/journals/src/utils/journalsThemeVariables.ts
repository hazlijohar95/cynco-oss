import { type Roles, themeToCSSVariables } from '@cynco/theme';

// Convenience wrapper binding @cynco/theme roles to this package's CSS
// variable prefix. Assign the result to a wrapping element's inline style
// (or serialize it for SSR) to theme every <journals-container> beneath it:
// the stylesheet reads `--journals-theme-*` between per-site overrides and
// the built-in light-dark() defaults.
export function journalsThemeVariables(roles: Roles): Record<string, string> {
  return themeToCSSVariables('journals', roles);
}
