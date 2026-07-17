import {
  AccountTree as AccountTreeComponent,
  type AccountTreeOptions,
} from '../render/AccountTree';
import {
  useAccountsInstance,
  type UseAccountsInstanceReturn,
} from './utils/useAccountsInstance';

export interface UseAccountTreeReturn extends UseAccountsInstanceReturn<AccountTreeComponent> {}

// Owns one vanilla AccountTree per mounted <accounts-container>: hydrates
// SSR output (or renders fresh) on mount, pushes option changes after every
// committed render, and tears the instance down on unmount. `getInstance()`
// exposes the imperative API (scrollToPath, setEntries, ...) to callers.
export function useAccountTree(
  options: AccountTreeOptions
): UseAccountTreeReturn {
  return useAccountsInstance<AccountTreeComponent>({
    create(container) {
      const instance = new AccountTreeComponent(options, true);
      instance.hydrate(container);
      return instance;
    },
    update(instance) {
      instance.setOptions(options);
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
}
