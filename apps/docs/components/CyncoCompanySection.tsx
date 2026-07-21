import { GITHUB_URL } from '@/lib/site';

// Company CTA section in the /data section grammar: 24px section heading,
// 16px muted copy, and a glossy neutral button. Content sits in a
// .section-reveal wrapper (not on the section, whose top hairline must stay
// pinned) for the landing page's scroll-entrance pass.
export function CyncoCompanySection() {
  return (
    <section className="border-border border-t px-6 py-16 md:px-10 md:py-24 lg:px-12">
      <div className="section-reveal">
        <div className="grid max-w-2xl gap-4">
          <h2 className="text-foreground text-2xl leading-none font-medium tracking-[-0.03em]">
            Built at Cynco
          </h2>
          <p className="text-muted-foreground text-base leading-normal">
            Accounting infrastructure, built the way systems engineers build
            databases: integer minor units end to end, entries that balance by
            construction, rendering that holds at six-figure row counts. These
            packages are the primitives under everything we ship.
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
      </div>
    </section>
  );
}
