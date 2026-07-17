# @cynco/theme

Cynco theme: color palettes and semantic roles for ledger UIs. Consumed by
`@cynco/journals` and `@cynco/accounts` as their default theme layer.

Palette ramps are derived from the MIT-licensed
[@pierre/theme](https://github.com/pierrecomputer/pierre) palettes by the
Pierre Computer Company; the `ledger` role group is Cynco's financial-domain
extension.

```ts
import { dark, themeToCSSVariables } from '@cynco/theme';

const style = themeToCSSVariables('journals', dark);
// { '--journals-theme-bg-editor': '#0a0a0a', ... }
```

## Roles

- `bg` / `fg` / `border` / `accent` — window chrome, strictly achromatic.
- `states` — match / success / danger / warn / info.
- `ledger` — financial semantics: `debit` and `credit` mirror diff added and
  deleted colors, plus tokens for dates, payees, accounts, currencies, tags,
  links, and reconciliation status.
