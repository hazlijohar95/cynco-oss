import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderPackageOgImage,
} from '@/lib/og/docs-og';

// Per-page OG card (Next's file convention wires the og:image meta; static
// export bakes the PNG at build time). Heading and claim come from
// DOCS_ORDER via the shared renderer.
// Static export requires the route to declare itself static explicitly.
export const dynamic = 'force-static';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  '@cynco/importers — bank exports (CSV, OFX) to statement lines and draft ' +
  'entries. Integer minor units, running-balance proof, fail loud.';

export default function OpengraphImage() {
  return renderPackageOgImage('/docs/importers');
}
