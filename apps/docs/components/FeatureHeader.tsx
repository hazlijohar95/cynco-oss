import type { ReactNode } from 'react';

interface FeatureHeaderProps {
  id?: string;
  title: string;
  description: ReactNode;
}

// Section header in the opencode /data grammar: a 24px medium-weight h2
// with tightened tracking over 16px muted copy at 1.5 line-height.
export function FeatureHeader({ id, title, description }: FeatureHeaderProps) {
  return (
    <div className="grid max-w-2xl gap-4">
      <h2
        id={id}
        className="text-foreground scroll-mt-24 text-2xl leading-none font-medium tracking-[-0.03em]"
      >
        {title}
      </h2>
      <p className="text-muted-foreground text-base leading-normal">
        {description}
      </p>
    </div>
  );
}
