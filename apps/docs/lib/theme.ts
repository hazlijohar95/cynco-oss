// Single source of truth for the site's color-mode plumbing. The header
// toggle, the footer three-state strip, and the pre-paint bootstrap in
// layout.tsx all speak this vocabulary: one storage key, one meta tint per
// resolved mode, one apply routine. The bootstrap can't import a module, so
// layout.tsx passes these constants into its stringified function instead of
// mirroring literals.

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = ResolvedTheme | 'system';

export const THEME_STORAGE_KEY = 'theme';

// Navbar tint (iOS Safari's <meta name="theme-color">) per resolved mode;
// matches the page --background values in globals.css.
export const MODE_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#161616',
};

const THEME_CHANGE_EVENT = 'cynco-theme-change';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

// Points the document's theme-color meta at `color`, creating the meta if it
// isn't there yet. Kept imperative (not JSX — React 19 hoists head tags and
// would manage a duplicate) so exactly one meta exists, owned by JS.
function setThemeColorMeta(color: string) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta == null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

// Applies a preference to the document and persists it. Explicit modes pin
// the html class + color-scheme; `system` removes both so the stylesheet's
// `color-scheme: light dark` + light-dark() tokens track the OS live (the
// CSS is designed for exactly that — see globals.css). Every apply
// broadcasts so all mounted theme controls stay in sync.
export function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (preference === 'system') {
    root.style.colorScheme = '';
  } else {
    root.classList.add(preference);
    root.style.colorScheme = preference;
  }
  setThemeColorMeta(MODE_THEME_COLOR[resolveTheme(preference)]);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private-mode storage failures only lose persistence, not the switch.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

// Notifies on any theme change: another control on the page, another tab
// (storage event), or an OS appearance flip while the preference is
// `system`. The OS branch also re-tints the navbar meta, since CSS can't
// reach it.
export function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onMediaChange = () => {
    if (readPreference() === 'system') {
      setThemeColorMeta(MODE_THEME_COLOR[systemTheme()]);
    }
    onChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyPreference(readPreference());
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  media.addEventListener('change', onMediaChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    media.removeEventListener('change', onMediaChange);
    window.removeEventListener('storage', onStorage);
  };
}
