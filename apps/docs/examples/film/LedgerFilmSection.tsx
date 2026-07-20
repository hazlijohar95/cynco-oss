import { LedgerFilmPlayer } from './LedgerFilmPlayer';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Footnote } from '@/components/Footnote';

// The closing section before the footer: a short programmatic film that shows
// the whole thesis in motion — an entry posts, sums to exactly zero, and
// rolls up the chart of accounts. Built with Remotion so every frame is
// rendered from the same integer-minor-unit data the packages use, in the
// page's own type and color scheme.
export function LedgerFilmSection() {
  return (
    <section className="border-border space-y-8 border-t px-6 py-16 md:px-10 md:py-24 lg:px-12">
      <FeatureHeader
        id="the-film"
        title="The whole idea, in ninety seconds"
        description={
          <>
            A payroll entry posts, its postings sum to exactly zero per
            currency, and the amounts roll up the chart of accounts. Rendered
            frame-by-frame from the same integer minor units the engine stores —
            no floats, no mockups — in the page&apos;s own monospace and color
            scheme.
          </>
        }
      />
      <LedgerFilmPlayer />
      <Footnote>
        Composed with <code>@remotion/player</code>: the film is a React
        component driven by the frame clock, so the numbers on screen are the
        data, not a recording of it.
      </Footnote>
    </section>
  );
}
