import {
  type ApplyThemeOptions,
  applyThemeToElement,
} from './applyThemeToElement';
import type { ThemeController } from './createThemeController';

// Binds a controller to an element: applies the current theme immediately,
// then re-applies on every controller change. The returned disconnect only
// unsubscribes — the applied variables and color-scheme pin are deliberately
// LEFT IN PLACE, because stripping them would flash unthemed (OS-preference)
// UI on teardown; the next apply (or element removal) cleans up naturally.
export function connectThemeController(
  controller: ThemeController,
  element: HTMLElement,
  options?: ApplyThemeOptions
): () => void {
  const apply = (): void => {
    applyThemeToElement(element, controller.getSnapshot(), options);
  };
  apply();
  return controller.subscribe(apply);
}
