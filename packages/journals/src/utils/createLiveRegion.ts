/** Handle for one polite live region owned by a component instance. */
export interface LiveRegion {
  readonly element: HTMLElement;
  announce(message: string): void;
  cleanUp(): void;
}

// Creates a visually-hidden `aria-live="polite"` region and appends it to
// `parent`. Design decisions, shared by every dynamic surface in the suite:
// - The region is a STABLE sibling of whatever the component re-renders via
//   innerHTML — callers must attach it OUTSIDE the re-rendered subtree, so a
//   wholesale section replacement never re-announces stale content and the
//   element identity (which screen readers track) survives every render.
// - `role="status"` + `aria-live="polite"` + `aria-atomic="true"` is the
//   belt-and-braces status-region trio: polite (never interrupts), atomic
//   (the whole message reads, not a text diff).
// - Created EMPTY and only ever written by explicit announce() calls, so
//   SSR/hydration can never replay a stale announcement.
// - Visual hiding uses the `visually-hidden` class from style.css (clip
//   pattern, still in the accessibility tree) — `display:none` would mute
//   the region entirely.
export function createLiveRegion(parent: ParentNode): LiveRegion {
  const element = document.createElement('div');
  element.className = 'visually-hidden';
  element.setAttribute('data-live-region', '');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  parent.appendChild(element);
  return {
    element,
    announce(message: string): void {
      element.textContent = message;
    },
    cleanUp(): void {
      element.remove();
    },
  };
}
