'use client';

import type { AccountStatusEntry } from '@cynco/accounts';
import { templateRender, useAccountTree } from '@cynco/accounts/react';
import type { RegisterRowData } from '@cynco/journals';
import { Register } from '@cynco/journals/react';
import { EntryStore, getAccountLeafName } from '@cynco/ledger-store';
import { workloads } from '@cynco/ledger-test-data';
import { Table2 } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import { buildRegisterRows } from './buildRegisterRows';
import { WORKSPACE_TREE_ID, WORKSPACE_TREE_OPTIONS } from './entries';

const INITIAL_ACCOUNT = 'Assets:Current:Cash-Maybank';

const STATUS_ENTRIES: readonly AccountStatusEntry[] = [
  { path: INITIAL_ACCOUNT, status: 'unreconciled', count: 4 },
  { path: 'Assets:Current:AR', status: 'pending', count: 2 },
  { path: 'Liabilities:Current:SST-Payable', status: 'flagged', count: 1 },
];

// Surface palette probed from the reference window: chrome #070707 (dark) /
// #ffffff (light) with the sidebar tree surface slightly elevated at
// #141415 / #f8f8f8, so the pane split reads through surface contrast alone
// (the divider itself is a transparent 1px column of chrome).
const WORKSPACE_SURFACES: CSSProperties = {
  '--accounts-bg-override': 'light-dark(#f8f8f8, #141415)',
  '--journals-bg-override': 'light-dark(#ffffff, #070707)',
} as CSSProperties;

// Tab captions use the leaf segment; getAccountLeafName returns '' for
// paths it cannot parse, so fall back to the full path.
function tabLabel(account: string): string {
  const leaf = getAccountLeafName(account);
  return leaf === '' ? account : leaf;
}

// The probed macOS traffic lights: 12px circles, 6px gap, the classic
// #ff5f56 / #ffbd2e / #27c93f triple.
function TrafficLights() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
      <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
      <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
    </div>
  );
}

export interface WorkspaceDemoProps {
  /** Shadow-root HTML from `preloadAccountTreeHTML`, rendered on the server. */
  ssrHTML: string;
}

// The hero centerpiece: a fake macOS accounting workspace built from the
// live components. Chart of accounts in the sidebar (SSR-prerendered),
// tab bar + account register in the editor pane; clicking a tree row swaps
// the register and the tab label. Every metric (14px window radius, 12px
// lights, 40px header/tab bar, 28px tab, 280px sidebar) matches the probed
// reference window.
export function WorkspaceDemo({ ssrHTML }: WorkspaceDemoProps) {
  // Seeded workload: byte-identical to the server preload on every visit.
  const entries = useMemo(() => workloads.small(), []);
  const store = useMemo(() => new EntryStore(entries), [entries]);
  const [account, setAccount] = useState(INITIAL_ACCOUNT);

  const rows: RegisterRowData[] = useMemo(
    () => buildRegisterRows(store, account),
    [store, account]
  );

  const { ref, getInstance } = useAccountTree({
    id: WORKSPACE_TREE_ID,
    entries,
    ...WORKSPACE_TREE_OPTIONS,
    onSelect: (selectedPaths, focusedPath) => {
      const path = selectedPaths[0] ?? focusedPath;
      if (path != null) setAccount(path);
    },
  });

  // Post-hydration decoration: status dots plus the initially selected
  // account, neither of which is part of the SSR controller options.
  useEffect(() => {
    const instance = getInstance();
    if (instance == null) return;
    instance.setAccountStatus(STATUS_ENTRIES);
    instance.getController().selectPath(INITIAL_ACCOUNT);
  }, [getInstance]);

  return (
    <div
      className="relative flex h-[560px] flex-col overflow-hidden rounded-[14px] border border-black/10 bg-white bg-clip-padding p-1.5 shadow-lg dark:border-white/10 dark:bg-[#070707]"
      style={WORKSPACE_SURFACES}
    >
      <div className="flex min-h-0 flex-1 flex-row">
        <aside className="flex w-[280px] shrink-0 flex-col max-md:w-[200px]">
          <div className="flex h-10 shrink-0 items-center gap-2.5 px-3">
            <TrafficLights />
            <div className="min-w-0 truncate text-xs font-medium text-zinc-900 dark:text-neutral-200">
              acme-sdn-bhd — Cynco
            </div>
          </div>
          <accounts-container
            ref={ref}
            className="min-h-0 flex-1 overflow-hidden rounded-lg"
          >
            {templateRender(null, ssrHTML)}
          </accounts-container>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          className="w-px shrink-0"
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-1 px-2 pt-[3px]">
            <div className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-sm bg-zinc-100 pr-3 pl-2 text-xs font-medium text-zinc-900 dark:bg-neutral-900 dark:text-zinc-100">
              <Table2 size={13} className="shrink-0 opacity-70" />
              <span className="truncate">{tabLabel(account)} — Register</span>
            </div>
          </div>
          <Register
            key={account}
            rows={rows}
            options={{ account, density: 'compact' }}
            className="min-h-0 flex-1 overflow-hidden rounded-lg"
          />
        </section>
      </div>
    </div>
  );
}
