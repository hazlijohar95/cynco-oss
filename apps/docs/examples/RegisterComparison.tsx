'use client';

import type { RegisterRowData } from '@cynco/journals';
import { Register } from '@cynco/journals/react';
import { EntryStore } from '@cynco/ledger-core';
import { workloads } from '@cynco/ledger-test-data';
import { AlignJustify, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { buildRegisterRows } from './buildRegisterRows';
import { useInViewOnce } from './useInViewOnce';
import { ComparisonHeading } from '@/components/ComparisonHeading';

const COMPARISON_ACCOUNT = 'Assets:Current:Cash-Maybank';
const PANE_HEIGHT = 320;

// Side-by-side density comparison: the same seeded register rendered at
// both presets, in the reference's two-pane pattern (labeled headings, a
// shared md 2-column grid at 24px gap, hairline-bordered panes). Workload
// generation is deferred until the section approaches the viewport.
export function RegisterComparison() {
  const [rows, setRows] = useState<RegisterRowData[] | null>(null);
  const { ref, inView } = useInViewOnce<HTMLDivElement>();

  useEffect(() => {
    if (!inView) return;
    const store = new EntryStore(workloads.small());
    setRows(buildRegisterRows(store, COMPARISON_ACCOUNT));
  }, [inView]);

  const panes = [
    {
      density: 'comfortable',
      icon: <Rows3 size={18} />,
      title: 'Comfortable',
      description: 'Payee and narration stacked — two lines per row.',
    },
    {
      density: 'compact',
      icon: <AlignJustify size={18} />,
      title: 'Compact',
      description: 'One line per row — twice the rows per viewport.',
    },
  ] as const;

  return (
    <div ref={ref} className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {panes.map(({ density, icon, title, description }) => (
        <div key={density}>
          <ComparisonHeading icon={icon} description={description}>
            {title}
          </ComparisonHeading>
          <div className="demo-container">
            {rows == null ? (
              <div
                className="text-muted-foreground flex items-center justify-center font-mono text-[13px]"
                style={{ height: PANE_HEIGHT }}
              >
                Generating…
              </div>
            ) : (
              <Register
                rows={rows}
                options={{ account: COMPARISON_ACCOUNT, density }}
                style={{ height: PANE_HEIGHT }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
