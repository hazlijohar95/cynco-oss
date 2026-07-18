import { ArrowUpRight, Github } from 'lucide-react';
import Link from 'next/link';

import { GITHUB_URL } from './Header';
import { Button } from '@/components/ui/button';

export function CyncoCompanySection() {
  return (
    <section className="mt-8 space-y-6 border-y py-16">
      <div className="space-y-3">
        <h2 className="text-2xl font-medium">With love from Cynco</h2>
        <p className="text-muted-foreground text-sm">
          Modern accounting infrastructure.
        </p>
        <p className="text-muted-foreground max-w-2xl">
          We build accounting infrastructure the way systems engineers build
          databases: integer minor units end to end, balanced-by-construction
          entries, and rendering that stays honest at a million rows. These
          packages are the primitives underneath everything we ship.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github size={16} />
            View on GitHub
            <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
    </section>
  );
}
