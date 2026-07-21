import { type Roles, themeToCSSVariables } from '@cynco/theme';

// Convenience wrapper binding @cynco/theme roles to this package's CSS
// variable prefix. Assign the result to a wrapping element's inline style
// (or serialize it for SSR) to theme every <statements-container> beneath
// it: the stylesheet reads `--statements-theme-*` between per-site overrides
// and the built-in light-dark() defaults.
export function statementsThemeVariables(roles: Roles): Record<string, string> {
  return themeToCSSVariables('statements', roles);
}
