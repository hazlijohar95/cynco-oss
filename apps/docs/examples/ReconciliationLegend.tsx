// Legend for the reconciliation pair states, matching the probed reference
// legend table: hairline-bordered rounded wrapper, muted/50 header row with
// 16px/10px cell padding, 40px body rows with 16px/8px padding, `code`
// state cells and muted descriptions. Indicator cells render live mini
// swatches driven by the same journals CSS variable chains the component
// uses (see .recon-swatch-* in globals.css), so themes and overrides apply.

interface LegendEntry {
  swatch: 'proposed' | 'accepted' | 'outstanding' | 'missing';
  state: string;
  description: string;
}

const LEGEND: readonly LegendEntry[] = [
  {
    swatch: 'proposed',
    state: 'proposed',
    description: 'Suggested by the matching engine — accept or reject',
  },
  {
    swatch: 'accepted',
    state: 'accepted',
    description: 'Cleared against the statement',
  },
  {
    swatch: 'outstanding',
    state: 'outstanding',
    description: 'In the books, not yet presented to the bank',
  },
  {
    swatch: 'missing',
    state: 'missing',
    description: 'On the statement, no book entry — create one',
  },
];

// One 24×24 indicator: two vertical halves standing in for the statement
// (left) and book (right) columns of a reconciliation pair.
function Swatch({ kind }: { kind: LegendEntry['swatch'] }) {
  const halves: Record<LegendEntry['swatch'], [string, string]> = {
    proposed: ['recon-swatch-match', 'recon-swatch-match'],
    accepted: ['recon-swatch-accepted', 'recon-swatch-accepted'],
    outstanding: ['recon-swatch-pinstripe', 'recon-swatch-plain'],
    missing: ['recon-swatch-plain', 'recon-swatch-pinstripe'],
  };
  const [left, right] = halves[kind];
  // aria-hidden, not aria-label: a label on a role-less <span> is ignored by
  // most assistive tech anyway, and the adjacent State cell already names the
  // state — the swatch is a visual duplicate.
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 gap-px overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.05)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
    >
      <span className={`h-full w-1/2 ${left}`} />
      <span className={`h-full w-1/2 ${right}`} />
    </span>
  );
}

export function ReconciliationLegend() {
  return (
    <div className="bg-background text-foreground w-full overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-[var(--color-border)]">
            <th className="w-24 px-4 py-2.5 text-left font-medium">
              Indicator
            </th>
            <th className="w-32 px-4 py-2.5 text-left font-medium">State</th>
            <th className="px-4 py-2.5 text-left font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {LEGEND.map((entry) => (
            <tr
              key={entry.state}
              className="border-b border-[var(--color-border)] last:border-b-0"
            >
              <td className="px-4 py-2">
                <Swatch kind={entry.swatch} />
              </td>
              <td className="px-4 py-2">
                <code>{entry.state}</code>
              </td>
              <td className="text-muted-foreground px-4 py-2">
                {entry.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
