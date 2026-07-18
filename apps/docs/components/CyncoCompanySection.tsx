import { GITHUB_URL } from './Header';

// Company CTA section in the /data section grammar: 24px section heading,
// 16px muted copy, and a glossy neutral button.
export function CyncoCompanySection() {
  return (
    <section className="border-border border-t px-6 py-16 md:px-10 md:py-24 lg:px-12">
      <div className="grid max-w-2xl gap-4">
        <h2 className="text-foreground text-2xl leading-none font-medium tracking-[-0.03em]">
          With love from Cynco
        </h2>
        <p className="text-muted-foreground text-base leading-normal">
          We build accounting infrastructure the way systems engineers build
          databases: integer minor units end to end, balanced-by-construction
          entries, and rendering that stays honest at a million rows. These
          packages are the primitives underneath everything we ship.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap gap-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-data btn-data-neutral"
        >
          <strong>View on GitHub</strong>
          <span>[↗]</span>
        </a>
      </div>
    </section>
  );
}
