import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import localFont from 'next/font/local';

import './globals.css';
import {
  MODE_THEME_COLOR,
  type ResolvedTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

// Geist serves docs prose only, so it loads without a preload hint — the
// marketing page paints entirely in the mono stack.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  preload: false,
});

// The brand monospace: Paper Mono by Paper (OFL 1.1, self-hosted — license
// alongside the file in fonts/). One variable file covers every weight the
// site uses (wght 100-800). adjustFontFallback is off because next/font's
// synthesized fallback is size-adjusted Arial — a proportional sans that
// would reflow tabular ledger layouts during the swap window; the system
// monos in globals.css --font-mono serve as the real fallbacks instead.
const paperMono = localFont({
  src: '../fonts/PaperMonoVariable.woff2',
  variable: '--font-paper-mono',
  weight: '100 800',
  adjustFontFallback: false,
});

// No `themeColor` here on purpose: the pre-paint bootstrap below owns the
// theme-color meta (a viewport-emitted meta would be a second, media-scoped
// tag the theme scripts can't reach — Safari would keep matching it).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const siteUrl = 'https://ledger.cynco.dev';
const title = 'Accounting by Cynco — ledger primitives for the web';
const description =
  '@cynco/journals renders journal entries and virtualized registers; ' +
  '@cynco/accounts renders the chart of accounts. Vanilla TypeScript core, ' +
  'React adapters, declarative shadow DOM SSR. Amounts are integer minor ' +
  'units end to end.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: '%s · Cynco',
  },
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: 'Cynco',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
};

// Applies the stored (or system) color mode before first paint: html class,
// native color-scheme, and the iOS navbar tint meta. Authored as a real
// function and stringified so it stays type-checked; the shared literals
// from lib/theme.ts are passed in as an argument instead of being mirrored.
// A `system` preference deliberately leaves the html class off so the
// stylesheet's `color-scheme: light dark` + light-dark() tokens keep
// following the OS live; lib/theme.ts applies the same rule after hydration.
function applyInitialTheme(config: {
  storageKey: string;
  colors: Record<ResolvedTheme, string>;
}) {
  try {
    const storedTheme = window.localStorage.getItem(config.storageKey);
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
    if (theme !== 'system') {
      root.classList.add(resolvedTheme);
      root.style.colorScheme = resolvedTheme;
    }

    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta == null) {
      themeColorMeta = document.createElement('meta');
      themeColorMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.setAttribute('content', config.colors[resolvedTheme]);
  } catch {
    // Ignore storage/media failures and let CSS defaults apply.
  }
}

const themeBootstrapScript = `(${String(applyInitialTheme)})(${JSON.stringify({
  storageKey: THEME_STORAGE_KEY,
  colors: MODE_THEME_COLOR,
})})`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${paperMono.variable}`}
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
