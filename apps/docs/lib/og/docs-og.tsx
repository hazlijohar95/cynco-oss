import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DOCS_ORDER } from '@/lib/site';

// Shared 1200x630 OpenGraph card for the docs routes, rendered at build
// time by each route's opengraph-image.tsx (static export evaluates these
// once and ships PNGs). The card is the site look in miniature: Paper Mono
// throughout, the package name huge, its one-line hard claim under it, a
// hairline frame, light scheme — the color literals are the light halves
// of the light-dark() tokens in globals.css.
//
// Satori (under ImageResponse) reads TTF/OTF/WOFF but not WOFF2 and not
// variable axes, so the brand font ships here as two static instances cut
// from fonts/PaperMonoVariable.woff2 (wght 400/600, subset to the ASCII +
// punctuation these cards can render). Same outlines, same license (OFL
// 1.1 — see fonts/PaperMono-LICENSE-OFL.txt).

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

// Builds always run from apps/docs (both the moon task and the wrangler
// deploy lane), so cwd-relative resolution matches next.config.ts.
function loadFonts(): Promise<[Buffer, Buffer]> {
  return Promise.all([
    readFile(join(process.cwd(), 'lib/og/paper-mono-400.ttf')),
    readFile(join(process.cwd(), 'lib/og/paper-mono-600.ttf')),
  ]);
}

/**
 * The card for a package page, looked up from DOCS_ORDER so the heading
 * and claim are the same package name and one-line hard claim the /docs
 * index and sidebar render — one source, no drift. Throws on an unknown
 * href: a typo'd route file should fail the build, not ship a blank card.
 */
export function renderPackageOgImage(href: string): Promise<ImageResponse> {
  const page = DOCS_ORDER.find((entry) => entry.href === href);
  if (page === undefined) {
    throw new Error(`No DOCS_ORDER entry for ${href}`);
  }
  return renderDocsOgImage({
    heading: page.packageName,
    claim: page.description,
  });
}

export interface DocsOgImageProps {
  /** The huge line: a package name, or "Documentation" for the index. */
  heading: string;
  /** The package's one-line hard claim (DOCS_ORDER descriptions). */
  claim: string;
}

export async function renderDocsOgImage({
  heading,
  claim,
}: DocsOgImageProps): Promise<ImageResponse> {
  const [regular, semibold] = await loadFonts();
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor: '#ffffff',
        padding: 40,
        fontFamily: 'Paper Mono',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          padding: '56px 64px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: 30,
          }}
        >
          <span style={{ color: '#161616', fontWeight: 600 }}>cynco</span>
          <span style={{ color: '#6b6b6b', fontWeight: 400 }}>docs</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              color: '#161616',
              fontSize: 84,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
            }}
          >
            {heading}
          </div>
          <div
            style={{
              marginTop: 32,
              maxWidth: 940,
              color: '#5c5c5c',
              fontSize: 27,
              fontWeight: 400,
              lineHeight: 1.55,
            }}
          >
            {claim}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 24,
            color: '#6b6b6b',
          }}
        >
          <span>ledger.cynco.dev</span>
          <span>MIT</span>
        </div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Paper Mono', data: regular, weight: 400, style: 'normal' },
        { name: 'Paper Mono', data: semibold, weight: 600, style: 'normal' },
      ],
    }
  );
}
