'use client';

import type { AccountStatusEntry, AccountTreeDensity } from '@cynco/accounts';
import { templateRender, useAccountTree } from '@cynco/accounts/react';
import { workloads } from '@cynco/ledger-test-data';
import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ACCOUNT_TREE_DEMO_ID } from './entries';
import { Footnote } from '@/components/Footnote';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

// Status decorations are view state (not part of the controller options), so
// they are applied post-hydration through the imperative instance API.
const STATUS_ENTRIES: readonly AccountStatusEntry[] = [
  {
    path: 'Assets:Current:Cash-Maybank',
    status: 'unreconciled',
    count: 4,
  },
  { path: 'Assets:Current:AR', status: 'pending', count: 2 },
  { path: 'Liabilities:Current:SST-Payable', status: 'flagged', count: 1 },
];

const DENSITIES: readonly AccountTreeDensity[] = [
  'compact',
  'default',
  'relaxed',
];

export interface AccountTreeDemoProps {
  /** Shadow-root HTML from `preloadAccountTreeHTML`, rendered on the server. */
  ssrHTML: string;
}

// Chart-of-accounts tree over the deterministic `small` workload with the
// full control surface: density presets (fixed row heights, so a density
// change remounts the element via key), live segment search through
// beginSearch/endSearch, and expand/collapse-all. The server pre-renders the
// default-density state; the client adopts that SSR shadow root in place.
export function AccountTreeDemo({ ssrHTML }: AccountTreeDemoProps) {
  // workloads.small() is seeded: this regenerates byte-identical entries to
  // the ones the server preloaded, without serializing 250 entries as props.
  const entries = useMemo(() => workloads.small(), []);
  const [density, setDensity] = useState<AccountTreeDensity>('default');
  const [query, setQuery] = useState('');

  const { ref, getInstance } = useAccountTree({
    id: ACCOUNT_TREE_DEMO_ID,
    entries,
    currency: 'MYR',
    initialExpansion: 'top-level',
    density,
  });

  // Re-apply the status dots after every (re)mount — density remounts
  // create a fresh instance.
  useEffect(() => {
    getInstance()?.setAccountStatus(STATUS_ENTRIES);
  }, [getInstance, density]);

  // Drive the search session from the input: beginSearch expands ancestors
  // of every match live; clearing restores the pre-search expansion.
  useEffect(() => {
    const controller = getInstance()?.getController();
    if (controller == null) return;
    if (query === '') {
      controller.endSearch();
    } else {
      controller.beginSearch(query);
    }
  }, [getInstance, query]);

  const changeDensity = (value: AccountTreeDensity) => {
    // The new instance starts a fresh (unsearched) session.
    setQuery('');
    setDensity(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup
          value={density}
          aria-label="Tree density"
          onValueChange={changeDensity}
        >
          {DENSITIES.map((value) => (
            <ButtonGroupItem key={value} value={value} className="capitalize">
              {value}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>

        <div className="relative">
          <Search
            size={14}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts…"
            spellCheck={false}
            aria-label="Search accounts"
            className="placeholder:text-muted-foreground/60 bg-secondary/50 focus-visible:outline-ring h-9 w-56 rounded-none border py-2 pr-3 pl-8 font-mono text-[13px] transition-[border-color,box-shadow] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>

        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground font-normal"
          onClick={() => getInstance()?.expandAll()}
        >
          <ChevronsUpDown size={16} />
          Expand all
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground font-normal"
          onClick={() => getInstance()?.collapseAll()}
        >
          <ChevronsDownUp size={16} />
          Collapse all
        </Button>
      </div>

      <div className="demo-container">
        <accounts-container key={density} ref={ref} style={{ height: 420 }}>
          {density === 'default' ? templateRender(null, ssrHTML) : null}
        </accounts-container>
      </div>
      <Footnote>
        250 entries · rolled-up balances · status dots via setAccountStatus() ·
        search expands ancestors of every match and restores the previous
        expansion on clear.
      </Footnote>
    </div>
  );
}
