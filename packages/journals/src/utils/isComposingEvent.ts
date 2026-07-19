/**
 * True for keydown events that belong to an active IME composition and must
 * never drive register behavior (row navigation, selection keys).
 *
 * During CJK/kana/Hangul composition the Enter that confirms a candidate and
 * the Escape that dismisses it are consumed by the IME and arrive with
 * `isComposing: true`. Older Safari/Edge (and some IMEs on current engines)
 * instead report the legacy `keyCode === 229` — the W3C "process key"
 * placeholder emitted for every keystroke the IME swallows — so both signals
 * are checked, exactly the guard Pierre's trees use. Own copy: packages do
 * not share private utils (@cynco/accounts carries the same function).
 */
export function isComposingEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
