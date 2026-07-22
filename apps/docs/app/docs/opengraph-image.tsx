import { OG_CONTENT_TYPE, OG_SIZE, renderDocsOgImage } from '@/lib/og/docs-og';

// Per-page OG card for the docs index (Next's file convention wires the
// og:image meta; static export bakes the PNG at build time). The claim is
// the suite's one contract, same as the index page's opening line.
// Static export requires the route to declare itself static explicitly.
export const dynamic = 'force-static';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  'Cynco documentation — five ledger packages, one contract: vanilla ' +
  'TypeScript cores, thin React adapters, integer minor units end to end.';

export default function OpengraphImage() {
  return renderDocsOgImage({
    heading: 'Documentation',
    claim:
      'Five packages, one contract: vanilla TypeScript cores, thin React ' +
      'adapters, declarative shadow DOM SSR, and integer minor units end ' +
      'to end — no floats ever touch money.',
  });
}
