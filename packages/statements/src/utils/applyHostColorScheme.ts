import type { ColorScheme } from '../types';

// Applies a pinned color scheme as an inline style on the host
// <statements-container>. The shadow stylesheet declares
// `:host { color-scheme: light dark }`, which makes light-dark() resolve
// from the USER's OS preference — not the page's chosen theme. An inline
// declaration on the host element lives in the outer tree, so it beats the
// shadow `:host` rule and forces light-dark() to the requested mode.
// `system` removes the inline pin so page-level CSS (e.g.
// `.dark statements-container { color-scheme: dark }`) stays in control.
export function applyHostColorScheme(
  container: HTMLElement,
  colorScheme: ColorScheme | undefined
): void {
  if (colorScheme === 'light' || colorScheme === 'dark') {
    container.style.setProperty('color-scheme', colorScheme);
  } else {
    container.style.removeProperty('color-scheme');
  }
}
