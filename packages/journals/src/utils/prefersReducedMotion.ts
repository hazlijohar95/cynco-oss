// Reads the user's reduced-motion preference. Guarded so it is safe under
// SSR (no window) and in test environments whose window lacks matchMedia
// (jsdom implements it, but the guard keeps the util environment-proof):
// absent APIs mean "no stated preference", so animation stays available and
// callers opt out only on an explicit `reduce`.
export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
