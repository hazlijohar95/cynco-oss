// The Twitter card is the OG card: re-exporting gives this route the same
// image, size, and alt, and overrides the generic /og.png the root layout
// declares for twitter.images (which the docs pages would otherwise
// inherit while their og:image is per-page). The `dynamic` segment config
// must be a literal here — Next refuses re-exported route config.
export const dynamic = 'force-static';
export { alt, contentType, default, size } from './opengraph-image';
