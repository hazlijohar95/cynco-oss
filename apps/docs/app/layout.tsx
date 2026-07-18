import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Mono } from 'next/font/google';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// The brand monospace (opencode-style lander type). Berkeley Mono is listed
// first in the CSS stack for users who have it installed; Plex Mono is the
// webfont everyone else gets.
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#161616' },
  ],
};

const title = 'Cynco, ledger primitives for the web';
const description =
  'Beautifully engineered ledger primitives: @cynco/journals renders journal ' +
  'entries and virtualized account registers, @cynco/accounts renders the ' +
  'chart of accounts. Vanilla core, React adapters, SSR built in.';

export const metadata: Metadata = {
  title: {
    default: title,
    template: '%s',
  },
  description,
};

// Applies the stored (or system) color mode before first paint: html class,
// native color-scheme, and the iOS navbar tint meta. Authored as a real
// function and stringified so it stays type-checked; the meta is created here
// (not in JSX — React 19 hoists head tags and would manage a duplicate) and
// owned by JS thereafter. Literals mirror ThemeToggle's MODE_THEME_COLOR.
const themeBootstrapScript = `(${String(function applyInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem('theme');
    const theme =
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : 'system';
    const resolvedTheme =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    const root = document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;

    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta == null) {
      themeColorMeta = document.createElement('meta');
      themeColorMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.setAttribute(
      'content',
      resolvedTheme === 'dark' ? '#161616' : '#ffffff'
    );
  } catch {
    // Ignore storage/media failures and let CSS defaults apply.
  }
})})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${plexMono.variable}`}
    >
      <head>
        <script
          id="docs-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
