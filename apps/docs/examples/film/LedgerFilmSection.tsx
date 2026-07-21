import { LedgerFilmPlayer } from './LedgerFilmPlayer';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Footnote } from '@/components/Footnote';

// The closing section before the footer: a short programmatic film that shows
// the whole thesis in motion — an entry posts, sums to exactly zero, and
// rolls up the chart of accounts. Built with Remotion so every frame is
// rendered from the same integer-minor-unit data the packages use, in the
// page's own type and color scheme. It stays the finale — the payoff after
// the primitives have made the argument.
// Content sits in a .section-reveal wrapper (not on the section, whose top
// hairline must stay pinned) for the landing page's scroll-entrance pass.
export function LedgerFilmSection() {
  return (
    <section className="border-border border-t px-6 py-16 md:px-10 md:py-24 lg:px-12">
      <div className="section-reveal space-y-8">
        <FeatureHeader
          id="the-film"
          title="The whole idea, in ninety seconds"
          description={
            <>
              An entry posts, sums to exactly zero, and rolls up the chart of
              accounts. Every frame rendered from the same integer minor units
              the engine stores — no mockups, no recordings.
            </>
          }
        />
        <LedgerFilmPlayer />
        <Footnote>
          Driven by <code>@remotion/player</code>&apos;s frame clock — the
          numbers on screen are the data.
        </Footnote>
      </div>
    </section>
  );
}
