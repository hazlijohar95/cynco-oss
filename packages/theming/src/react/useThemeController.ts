import { useSyncExternalStore } from 'react';

import type { ThemeController } from '../createThemeController';
import type { ThemeControllerSnapshot } from '../types';

// Binds a ThemeController to React. A pure useSyncExternalStore wrapper with
// no state of its own — mode, persistence, and system tracking all live in
// the controller, so vanilla hosts share the exact same behavior. The
// controller's snapshot is frozen and reference-stable between changes,
// which is precisely the contract useSyncExternalStore needs (no tearing,
// no render loops); getSnapshot doubles as the server snapshot because the
// controller is SSR-safe and resolves headlessly.
export function useThemeController(
  controller: ThemeController
): ThemeControllerSnapshot {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
}
