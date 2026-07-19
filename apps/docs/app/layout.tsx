import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import localFont from 'next/font/local';

import './globals.css';

// Geist serves docs prose only, so it loads without a preload hint — the
// marketing page paints entirely in the mono stack.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  preload: false,
});

// The brand monospace: Paper Mono by Paper (OFL 1.1, self-hosted — license
// alongside the file in fonts/). One variable file covers every weight the
// site uses (wght 100-800).
const paperMono = localFont({
  src: '../fonts/PaperMonoVariable.woff2',
  variable: '--font-paper-mono',
  weight: '100 800',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#161616' },
  ],
};

const siteUrl = 'https://cynco-docs.hazli-johar.workers.dev';
const title = 'Cynco — ledger primitives for the web';
const description =
  '@cynco/journals renders journal entries and virtualized registers; ' +
  '@cynco/accounts renders the chart of accounts. Vanilla TypeScript core, ' +
  'React adapters, declarative shadow DOM SSR. Amounts are integer minor ' +
  'units end to end.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: '%s',
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
