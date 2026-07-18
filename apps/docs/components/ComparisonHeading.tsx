import type { ReactNode } from 'react';

export interface ComparisonHeadingProps {
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

// Label row above one pane of a side-by-side comparison, matching the
// probed reference metrics: 18px medium heading with a small leading icon
// at 6px gap, optional muted 14px description, 12px below.
export function ComparisonHeading({
  icon,
  description,
  children,
}: ComparisonHeadingProps) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-1.5 text-lg font-medium">
        {icon != null ? <span className="shrink-0">{icon}</span> : null}
        {children}
      </h3>
      {description != null ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
  );
}
