import { CornerDownRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface FootnoteProps {
  children: ReactNode;
}

// Demo-caption footnote: the ↳ return glyph at half opacity, muted small
// text, links inside styled via `.footnote-link` (1px underline, 0.25em
// offset). Rendered directly under a demo container.
export function Footnote({ children }: FootnoteProps) {
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
      <CornerDownRight
        size={14}
        className="mt-[3px] shrink-0 opacity-50"
        aria-hidden="true"
      />
      <span>{children}</span>
    </p>
  );
}
