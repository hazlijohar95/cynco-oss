'use client';

import { JournalEntry } from '@cynco/journals/react';
import {
  contrastRatio,
  type CvdKind,
  dark,
  darkCvd,
  darkTritan,
  deltaE2000,
  light,
  lightCvd,
  lightTritan,
  parseHex,
  type Roles,
  simulateCvd,
} from '@cynco/theme';
import { Eye, EyeOff } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';

import { CVD_SAMPLE_ENTRY } from './fixtures';
import { mergedJournalsThemeVariables } from './mergedThemeVariables';
import { Footnote } from '@/components/Footnote';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type Variant = 'cvd' | 'tritan';

const VARIANTS: Record<
  Variant,
  {
    label: string;
    kind: CvdKind;
    kindLabel: string;
    lightRoles: Roles;
    darkRoles: Roles;
  }
> = {
  cvd: {
    label: 'Protan/deutan-safe',
    kind: 'deuteranopia',
    kindLabel: 'deuteranopia',
    lightRoles: lightCvd,
    darkRoles: darkCvd,
  },
  tritan: {
    label: 'Tritan-safe',
    kind: 'tritanopia',
    kindLabel: 'tritanopia',
    lightRoles: lightTritan,
    darkRoles: darkTritan,
  },
};

interface Receipt {
  scheme: 'light' | 'dark';
  /** ΔE₀₀ between simulated debit and credit under full dichromacy. */
  deltaE: number;
  /** Min WCAG contrast of simulated debit/credit on the simulated editor bg. */
  contrast: number;
}

// The same math the package's permanent test gate runs: simulate every
// gated color at severity-1.0 dichromacy, then measure the SIMULATED
// colors. All inputs come straight out of the exported role objects.
function measure(
  roles: Roles,
  kind: CvdKind,
  scheme: Receipt['scheme']
): Receipt {
  const debit = simulateCvd(parseHex(roles.ledger.debit)!, kind);
  const credit = simulateCvd(parseHex(roles.ledger.credit)!, kind);
  const bg = simulateCvd(parseHex(roles.bg.editor)!, kind);
  return {
    scheme,
    deltaE: deltaE2000(debit, credit),
    contrast: Math.min(contrastRatio(debit, bg), contrastRatio(credit, bg)),
  };
}

function formatReceipt({ scheme, deltaE, contrast }: Receipt): string {
  return `${scheme} ΔE₀₀ ${deltaE.toFixed(1)}, contrast ${contrast.toFixed(2)}`;
}

function Pane({
  title,
  detail,
  receipts,
  themeStyle,
  entryHTML,
}: {
  title: string;
  detail: string;
  receipts: readonly Receipt[];
  themeStyle: CSSProperties;
  entryHTML: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-mono">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </div>
      <div className="demo-container" style={themeStyle}>
        <JournalEntry entry={CVD_SAMPLE_ENTRY} ssrHTML={entryHTML} />
      </div>
      <p className="text-muted-foreground mt-2 font-mono text-xs">
        {receipts.map(formatReceipt).join(' · ')}
      </p>
    </div>
  );
}

export interface CvdComparisonProps {
  /** Shadow-root HTML from `preloadJournalEntryHTML(CVD_SAMPLE_ENTRY)`.
   * Shared by both panes — the theme layer is CSS variables only, so one
   * preload serves every role set. */
  entryHTML: string;
}

// Base role set beside the shipped accessible set, applied to the same
// server-rendered entry — no simulation filter, just the real tokens. The
// per-pane receipts ARE the gate's numbers, computed here from the exported
// simulateCvd/deltaE2000/contrastRatio at render time.
export function CvdComparison({ entryHTML }: CvdComparisonProps) {
  const [variant, setVariant] = useState<Variant>('cvd');
  const { label, kind, kindLabel, lightRoles, darkRoles } = VARIANTS[variant];

  const baseStyle = useMemo(
    () => mergedJournalsThemeVariables(light, dark) as CSSProperties,
    []
  );
  const safeStyle = useMemo(
    () => mergedJournalsThemeVariables(lightRoles, darkRoles) as CSSProperties,
    [lightRoles, darkRoles]
  );

  const baseReceipts = useMemo(
    () => [measure(light, kind, 'light'), measure(dark, kind, 'dark')],
    [kind]
  );
  const safeReceipts = useMemo(
    () => [
      measure(lightRoles, kind, 'light'),
      measure(darkRoles, kind, 'dark'),
    ],
    [lightRoles, darkRoles, kind]
  );

  return (
    <div className="space-y-4">
      <ButtonGroup<Variant>
        value={variant}
        aria-label="Accessible role set"
        onValueChange={setVariant}
      >
        <ButtonGroupItem value="cvd">
          <EyeOff size={16} />
          Protan/deutan-safe
        </ButtonGroupItem>
        <ButtonGroupItem value="tritan">
          <Eye size={16} />
          Tritan-safe
        </ButtonGroupItem>
      </ButtonGroup>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Pane
          title="Base roles"
          detail={`simulated ${kindLabel}`}
          receipts={baseReceipts}
          themeStyle={baseStyle}
          entryHTML={entryHTML}
        />
        <Pane
          title={label}
          detail={`simulated ${kindLabel}`}
          receipts={safeReceipts}
          themeStyle={safeStyle}
          entryHTML={entryHTML}
        />
      </div>
      <Footnote>
        Both cards render the shipped role sets — no simulation filter on the
        pixels. The figures under each card are computed here, at render time,
        by the package&apos;s exported <code>simulateCvd</code> +{' '}
        <code>deltaE2000</code> + <code>contrastRatio</code> — the same math the
        permanent test gate asserts. ΔE₀₀ ≈ 2–3 is just noticeable; the gate
        requires ≥ 20 and simulated contrast ≥ 3.0.
      </Footnote>
    </div>
  );
}
