import Link from 'next/link';

// Branded 404 in the site grammar: weak-tier bracket tag, section-size
// heading, one line of ledger-flavored copy, and the glossy contrast
// button home. Statically exported as 404.html and served by the Workers
// assets `not_found_handling` setting.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center font-mono">
      <p className="text-text-weak text-[13px] leading-none">[404]</p>
      <h1 className="text-foreground text-2xl leading-none font-medium tracking-[-0.03em]">
        No entry at this address
      </h1>
      <p className="text-muted-foreground text-base leading-normal">
        The path doesn&apos;t resolve to any page — the books stay balanced
        anyway.
      </p>
      <div className="mt-3">
        <Link href="/" className="btn-data btn-data-contrast">
          <strong>Back to the ledger</strong>
        </Link>
      </div>
    </div>
  );
}
