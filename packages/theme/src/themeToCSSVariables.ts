import type { Roles } from './roles/Roles';

// Flattens a Roles object into the CSS custom properties that the ledger
// components (@cynco/journals, @cynco/accounts) consume as their theme layer.
// Keys follow the component convention `--<prefix>-theme-<group>-<token>`,
// e.g. `--journals-theme-ledger-debit`. Consumers assign the returned record
// onto a wrapping element's inline style (or serialize it for SSR).
export function themeToCSSVariables(
  prefix: string,
  roles: Roles
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [groupName, group] of Object.entries(roles)) {
    for (const [tokenName, value] of Object.entries(group)) {
      variables[`--${prefix}-theme-${groupName}-${kebabCase(tokenName)}`] =
        value;
    }
  }
  return variables;
}

// `balanceNegative` -> `balance-negative`; single-word tokens pass through.
function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
