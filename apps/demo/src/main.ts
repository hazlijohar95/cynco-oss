import {
  type AccountDropCollision,
  type AccountMove,
  AccountTree,
  type AccountTreeContextMenuRequest,
  type AccountTreeSearchMode,
  createDefaultAccountIconResolver,
} from '@cynco/accounts';
import {
  createEntryStreamFromArray,
  EntryDiff,
  EntryStream,
  formatMinorUnits,
  JournalEntry,
  type LedgerEntry as JournalsLedgerEntry,
  type LedgerSection,
  LedgerView,
  Reconciliation,
  Register,
  type RegisterDensity,
  type RegisterFilter,
  type RegisterGroupBy,
  type RegisterRowData,
} from '@cynco/journals';
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerPoolManager,
} from '@cynco/journals/worker';
// Vite bundles the portable worker (fully self-contained ESM) into a
// same-origin worker asset and hands back a constructor.
import JournalsWorkerPortable from '@cynco/journals/worker/worker-portable.js?worker';
import {
  EntryStore,
  isEntryBalanced,
  type LedgerEntry,
} from '@cynco/ledger-core';
import {
  WORKLOAD_ENTRY_COUNTS,
  type WorkloadName,
  workloads,
} from '@cynco/ledger-test-data';
import {
  BalanceSheet,
  createAccountTaxonomy,
  deriveBalanceSheet,
  deriveIncomeStatement,
  deriveTrialBalance,
  IncomeStatement,
  type StatementDate,
  type StatementPeriod,
  TrialBalance,
} from '@cynco/statements';
import {
  connectThemeController,
  createThemeController,
  defaultCatalog,
} from '@cynco/theming';

import { buildRegisterRows } from './buildRegisterRows';
import {
  RECONCILIATION_ACCOUNT,
  RECONCILIATION_PERIOD,
  RECONCILIATION_POSTINGS,
  RECONCILIATION_STATEMENT_LINES,
} from './reconciliationData';
import { SHOWCASE_ENTRIES } from './showcaseEntries';
import './styles.css';

// --- Demo toggles ----------------------------------------------------------

/** Adds the `large` workload (100k entries) and selects it by default. */
const CRAZY_LEDGER = false;

/**
 * Renders the big register's row windows through the @cynco/journals worker
 * pool instead of on the main thread. Flip off to compare; output is
 * byte-identical either way (same renderer runs in both places).
 */
const USE_WORKER_POOL = true;

const DEFAULT_WORKLOAD: WorkloadName = CRAZY_LEDGER ? 'large' : 'medium';
const REGISTER_ACCOUNT = 'Assets:Current:Cash-Maybank';
const LEDGER_VIEW_ACCOUNTS: readonly string[] = [
  'Assets:Current:Cash-Maybank',
  'Assets:Current:AR',
  'Income:Sales:Services-Consulting',
  'Expenses:Payroll:Salaries',
  'Liabilities:Current:SST-Payable',
];

function isWorkloadName(value: string): value is WorkloadName {
  return Object.hasOwn(WORKLOAD_ENTRY_COUNTS, value);
}

// --- DOM lookups -----------------------------------------------------------

// The demo owns its index.html, so a missing element is a programmer error;
// failing loudly at boot beats null-guarding every use site.
function mustGetElement<T extends HTMLElement>(
  id: string,
  kind: new () => T
): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) {
    throw new Error(`demo: expected #${id} to be a ${kind.name}`);
  }
  return element;
}

const stage = mustGetElement('stage', HTMLElement);
const themeSelect = mustGetElement('theme-select', HTMLSelectElement);
const densitySelect = mustGetElement('density-select', HTMLSelectElement);
const workloadSelect = mustGetElement('workload-select', HTMLSelectElement);
const chromeToggle = mustGetElement('chrome-toggle', HTMLButtonElement);
const workloadStats = mustGetElement('workload-stats', HTMLElement);
const entryGallery = mustGetElement('entry-gallery', HTMLElement);
const registerHost = mustGetElement('register-host', HTMLElement);
const registerReadout = mustGetElement('register-readout', HTMLElement);
const registerGroupBySelect = mustGetElement(
  'register-groupby',
  HTMLSelectElement
);
const registerRangeToggle = mustGetElement(
  'register-range-toggle',
  HTMLInputElement
);
const registerFilterInput = mustGetElement('register-filter', HTMLInputElement);
const registerFilterState = mustGetElement(
  'register-filter-state',
  HTMLElement
);
const entryDiffHost = mustGetElement('entrydiff-host', HTMLElement);
const ledgerHost = mustGetElement('ledger-host', HTMLElement);
const ledgerReadout = mustGetElement('ledger-readout', HTMLElement);
const ledgerControls = mustGetElement('ledger-controls', HTMLElement);
const ledgerShuffle = mustGetElement('ledger-shuffle', HTMLButtonElement);
const reconciliationHost = mustGetElement('reconciliation-host', HTMLElement);
const reconciliationReadout = mustGetElement(
  'reconciliation-readout',
  HTMLElement
);
const accountsHost = mustGetElement('accounts-host', HTMLElement);
const accountsReadout = mustGetElement('accounts-readout', HTMLElement);
const flattenToggle = mustGetElement('flatten-toggle', HTMLInputElement);
const treeCollisionSelect = mustGetElement('tree-collision', HTMLSelectElement);
const treeReset = mustGetElement('tree-reset', HTMLButtonElement);
const treeSearchInput = mustGetElement('tree-search', HTMLInputElement);
const treeSearchMode = mustGetElement('tree-search-mode', HTMLSelectElement);
const treeSearchPrev = mustGetElement('tree-search-prev', HTMLButtonElement);
const treeSearchNext = mustGetElement('tree-search-next', HTMLButtonElement);
const treeSearchState = mustGetElement('tree-search-state', HTMLElement);
const streamHost = mustGetElement('stream-host', HTMLElement);
const streamRestart = mustGetElement('stream-restart', HTMLButtonElement);
const trialBalanceHost = mustGetElement('trial-balance-host', HTMLElement);
const incomeStatementHost = mustGetElement(
  'income-statement-host',
  HTMLElement
);
const balanceSheetHost = mustGetElement('balance-sheet-host', HTMLElement);
const statementsReadout = mustGetElement('statements-readout', HTMLElement);

// --- Theme / chrome controls -------------------------------------------------

// @cynco/theming replaces the demo's previous hand-rolled variable
// bookkeeping: the controller owns the mode + per-scheme theme choice, and
// connectThemeController keeps the stage wrapper's `--journals-theme-*` /
// `--accounts-theme-*` inline variables and `color-scheme` pin in sync
// (every <journals-container> / accounts host beneath reads them).
const themeController = createThemeController({
  catalog: defaultCatalog,
  initialMode: 'dark',
});
connectThemeController(themeController, stage, {
  prefixes: ['journals', 'accounts', 'statements'],
});

// Demo-specific reactions the generic connector doesn't cover: the toolbar
// select mirrors the active theme, the page chrome class follows the
// resolved scheme, and the account tree rebuilds on scheme changes because
// it pins light-dark() resolution per instance (colorScheme option).
themeController.subscribe(() => {
  const { resolvedScheme, themeName } = themeController.getSnapshot();
  themeSelect.value = themeName;
  setChromeScheme(resolvedScheme);
  if (resolvedScheme !== currentScheme) {
    currentScheme = resolvedScheme;
    if (accountTree != null) {
      renderAccountTree();
    }
  }
});

// The toolbar select offers every catalog theme (including the
// colorblind-safe variants). Picking one assigns it to its scheme slot and
// pins the mode to that scheme, so e.g. choosing "Light (soft)" while dark
// flips the demo to light — matching the old single-select behavior.
function populateThemeSelect(): void {
  themeSelect.replaceChildren();
  for (const entry of defaultCatalog.list()) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.label;
    themeSelect.appendChild(option);
  }
  themeSelect.value = themeController.getSnapshot().themeName;
}

themeSelect.addEventListener('change', () => {
  const entry = defaultCatalog.get(themeSelect.value);
  if (entry == null) return;
  themeController.setTheme(entry.name);
  themeController.setMode(entry.scheme);
});

// Flips the page chrome (html class drives page colors and light-dark()
// fallbacks) independently of the component theme, to demonstrate that the
// theme variables pin component colors regardless of the page scheme.
function setChromeScheme(scheme: 'dark' | 'light'): void {
  document.documentElement.className = scheme;
  chromeToggle.textContent = `Chrome: ${scheme}`;
}

chromeToggle.addEventListener('click', () => {
  const next = document.documentElement.className === 'dark' ? 'light' : 'dark';
  setChromeScheme(next);
});

// --- JournalEntry gallery ----------------------------------------------------

// Entry cards render once; they are static fixtures and survive theme and
// workload changes untouched (theming flows through CSS variables alone).
function renderEntryGallery(): void {
  for (const item of SHOWCASE_ENTRIES) {
    const card = document.createElement('article');
    card.className = 'entry-card';

    const head = document.createElement('div');
    head.className = 'entry-card-head';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const badge = document.createElement('span');
    badge.className = 'entry-card-badge';
    const balanced = isEntryBalanced(item.entry);
    badge.textContent = balanced ? 'balanced' : 'unbalanced';
    if (!balanced) {
      badge.setAttribute('data-unbalanced', '');
    }
    head.append(title, badge);
    card.appendChild(head);

    const instance = new JournalEntry({
      showLineNumbers: item.showLineNumbers ?? false,
      renderPostingAnnotation:
        item.annotatePostingIndex == null
          ? undefined
          : (_posting, index): HTMLElement | null =>
              index === item.annotatePostingIndex
                ? createAnnotationElement(item.annotationText ?? '')
                : null,
    });
    instance.render({ entry: item.entry, parentNode: card });

    const note = document.createElement('p');
    note.className = 'entry-card-note';
    note.textContent = item.note;
    card.appendChild(note);

    entryGallery.appendChild(card);
  }
}

// Annotation content lives inside the component's shadow root, so page CSS
// cannot reach it; the few styles it needs are set inline.
function createAnnotationElement(text: string): HTMLElement {
  const element = document.createElement('div');
  element.textContent = text;
  element.style.padding = '4px 12px 8px';
  element.style.fontSize = '11px';
  element.style.opacity = '0.7';
  return element;
}

// --- Workload data -----------------------------------------------------------

// Generated workloads are deterministic but not free (medium = 10k entries,
// large = 100k), so stores are built once per workload and cached.
const storeCache = new Map<WorkloadName, EntryStore>();

function getStore(name: WorkloadName): EntryStore {
  let store = storeCache.get(name);
  if (store == null) {
    store = new EntryStore(workloads[name]());
    storeCache.set(name, store);
  }
  return store;
}

// --- Register + LedgerView ---------------------------------------------------

let register: Register | undefined;
let ledgerView: LedgerView | undefined;

function describeRow(row: RegisterRowData, index: number): string {
  const { entry, posting } = row;
  const amount = formatMinorUnits(posting.amount, posting.currency, {
    sign: 'always',
  });
  const balance = row.runningBalance.get(posting.currency);
  const balanceText =
    balance == null
      ? ''
      : ` · balance ${formatMinorUnits(balance, posting.currency)} ${posting.currency}`;
  const description = entry.payee ?? entry.narration;
  return `#${index} ${entry.date} ${description} ${amount} ${posting.currency}${balanceText}`;
}

function isGroupByName(value: string): value is RegisterGroupBy {
  return (
    value === 'none' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
  );
}

// The filter input's current value as a RegisterFilter, or null when empty
// (null keeps the register's unfiltered fast path). Shared by the input
// listener and every rebuild so a groupBy/density change never loses the
// active query.
function currentRegisterFilter(): RegisterFilter | null {
  const query = registerFilterInput.value;
  return query === '' ? null : { query };
}

// (Re)creates the standalone Register. Density affects both CSS row height
// and the JS window math, so density changes rebuild the instance instead of
// mutating options in place; the groupBy/selection controls rebuild too so
// every toggle exercises a cold construction path.
function renderRegister(
  rows: RegisterRowData[],
  density: RegisterDensity
): void {
  register?.cleanUp();
  const groupBy = isGroupByName(registerGroupBySelect.value)
    ? registerGroupBySelect.value
    : 'none';
  const filter = currentRegisterFilter();
  registerFilterState.textContent = '';
  register = new Register({
    account: REGISTER_ACCOUNT,
    density,
    groupBy,
    selectionMode: registerRangeToggle.checked ? 'range' : 'single',
    // The filter survives rebuilds (groupBy/density/workload changes) via
    // the options seed; per-keystroke updates go through setFilter below.
    filter: filter ?? undefined,
    workerPool,
    onRowSelect(row, index) {
      console.log('register row selected', index, row);
      registerReadout.textContent = describeRow(row, index);
    },
    onSelectionChange({ indexes, rows: selectedRows }) {
      console.log('register selection changed', indexes, selectedRows);
      if (indexes.length > 1) {
        registerReadout.textContent =
          `${indexes.length} rows selected ` +
          `(#${indexes[0]}…#${indexes[indexes.length - 1]})`;
      }
    },
    onFilterResult({ matched, total }) {
      registerFilterState.textContent =
        `${matched.toLocaleString('en-MY')} of ` +
        `${total.toLocaleString('en-MY')} rows`;
    },
  });
  register.render({ rows, parentNode: registerHost });
}

// Per-keystroke projection update on the LIVE instance — no rebuild: the
// filter is a projection overlay, so it composes with the groupBy select
// (filtered period summaries) and range selection untouched. Clearing the
// input clears the readout (onFilterResult only fires for active filters).
registerFilterInput.addEventListener('input', () => {
  const filter = currentRegisterFilter();
  if (filter == null) {
    registerFilterState.textContent = '';
  }
  register?.setFilter(filter);
});

// Current LedgerView sections in display order; the shuffle button mutates
// this order and pushes it through incremental setSections.
let ledgerSections: LedgerSection[] = [];

// (Re)creates the multi-account LedgerView over a handful of accounts from
// the generated chart, all behind one shared virtualizer, plus the smooth
// scroll-to-section buttons for each account.
function renderLedgerView(store: EntryStore, density: RegisterDensity): void {
  ledgerView?.cleanUp();
  ledgerView = new LedgerView({
    density,
    onRowSelect(account, row, index) {
      console.log('ledger view row selected', account, index, row);
      ledgerReadout.textContent = `${account} · ${describeRow(row, index)}`;
    },
  });
  ledgerSections = LEDGER_VIEW_ACCOUNTS.map((account) => ({
    account,
    rows: buildRegisterRows(store, account),
  }));
  ledgerView.render({ sections: ledgerSections, parentNode: ledgerHost });
  renderLedgerScrollButtons();
}

// One "scroll to section" button per account, exercising the shared
// critically-damped spring (behavior: 'smooth'); rebuilt with the view so
// the buttons always target live sections.
function renderLedgerScrollButtons(): void {
  for (const button of ledgerControls.querySelectorAll(
    '[data-ledger-scroll]'
  )) {
    button.remove();
  }
  for (const account of LEDGER_VIEW_ACCOUNTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-ledger-scroll', account);
    const leaf = account.split(':').pop() ?? account;
    button.textContent = `→ ${leaf}`;
    button.title = `Smooth scroll to ${account}`;
    button.addEventListener('click', () => {
      ledgerView?.scrollToSection(account, { behavior: 'smooth' });
    });
    ledgerControls.appendChild(button);
  }
}

// Deterministic reorder (rotate by one, then swap the new head pair) so
// every click visibly reorders sections while the scroll anchor keeps the
// content you were reading in place — the incremental setSections path.
ledgerShuffle.addEventListener('click', () => {
  if (ledgerView == null || ledgerSections.length < 2) {
    return;
  }
  const rotated = [...ledgerSections.slice(1), ledgerSections[0]];
  [rotated[0], rotated[1]] = [rotated[1], rotated[0]];
  ledgerSections = rotated;
  ledgerView.setSections(ledgerSections);
});

// Rebuilds just the standalone register for the groupBy / selection-mode
// controls, without paying for the ledger view and account tree rebuilds.
function rebuildRegisterOnly(): void {
  const workload = isWorkloadName(workloadSelect.value)
    ? workloadSelect.value
    : DEFAULT_WORKLOAD;
  const density: RegisterDensity =
    densitySelect.value === 'compact' ? 'compact' : 'comfortable';
  renderRegister(
    buildRegisterRows(getStore(workload), REGISTER_ACCOUNT),
    density
  );
  registerReadout.textContent = 'No row selected.';
}

registerGroupBySelect.addEventListener('change', rebuildRegisterOnly);
registerRangeToggle.addEventListener('change', rebuildRegisterOnly);

// --- Entry diff ----------------------------------------------------------------

// Handcrafted before/after pair: cash amount changed, narration reworded
// (word-level diff), a bank-fee posting added. Static fixture — renders once
// and themes through CSS variables like the entry gallery.
function renderEntryDiff(): void {
  const before: JournalsLedgerEntry = {
    id: 'audit-entry-1',
    date: '2026-03-14',
    flag: 'pending',
    payee: 'Acme Sdn Bhd',
    narration: 'Monthly consulting invoice for March',
    tags: ['ops'],
    links: ['inv-1042'],
    postings: [
      {
        account: 'Assets:Current:Cash-Maybank',
        amount: 150_000,
        currency: 'MYR',
      },
      {
        account: 'Income:Sales:Services-Consulting',
        amount: -150_000,
        currency: 'MYR',
      },
    ],
  };
  const after: JournalsLedgerEntry = {
    id: 'audit-entry-1',
    date: '2026-03-14',
    flag: 'cleared',
    payee: 'Acme Sdn Bhd',
    narration: 'Monthly retainer invoice for March',
    tags: ['ops'],
    links: ['inv-1042'],
    postings: [
      {
        account: 'Assets:Current:Cash-Maybank',
        amount: 149_000,
        currency: 'MYR',
      },
      {
        account: 'Income:Sales:Services-Consulting',
        amount: -150_000,
        currency: 'MYR',
      },
      { account: 'Expenses:Bank:Fees', amount: 1_000, currency: 'MYR' },
    ],
  };
  const instance = new EntryDiff({});
  instance.render({ before, after, parentNode: entryDiffHost });
}

// --- Worker pool ---------------------------------------------------------------

// One pool for the page; components fall back to the main thread on any
// worker failure, so this is always safe to create.
const workerPool: WorkerPoolManager | undefined = USE_WORKER_POOL
  ? getOrCreateWorkerPoolSingleton({
      workerFactory: () => new JournalsWorkerPortable(),
    })
  : undefined;

// --- Entry stream ----------------------------------------------------------------

let entryStream: EntryStream | undefined;

// (Re)starts the streamed feed: 60 deterministic workload entries arriving
// on a 40ms cadence. Restarting tears the old instance down (cancelling its
// reader) and attaches a fresh single-use stream.
function renderEntryStream(): void {
  entryStream?.cleanUp();
  const entries = workloads.small().slice(0, 60);
  entryStream = new EntryStream({
    stream: createEntryStreamFromArray(entries, { delayMs: 40 }),
    total: entries.length,
    showLineNumbers: false,
    onDone(count) {
      console.log(`entry stream done: ${count} entries`);
    },
  });
  entryStream.render({ parentNode: streamHost });
}

streamRestart.addEventListener('click', renderEntryStream);

// --- Chart of accounts --------------------------------------------------------

let accountTree: AccountTree | undefined;
let currentScheme: 'dark' | 'light' =
  themeController.getSnapshot().resolvedScheme;

// The tree needs raw entries (its controller owns balances and the rename /
// drag&drop remap machinery), so workload entry lists are cached separately
// from the EntryStore cache.
const entriesCache = new Map<WorkloadName, LedgerEntry[]>();

function getEntries(name: WorkloadName): LedgerEntry[] {
  let entries = entriesCache.get(name);
  if (entries == null) {
    entries = workloads[name]();
    entriesCache.set(name, entries);
  }
  return entries;
}

function describeMoves(moves: readonly AccountMove[]): string {
  return moves.map((move) => `${move.from} → ${move.to}`).join(' · ');
}

// Posting counts per account, computed once per workload from the same
// public entries the tree is seeded with — the decoration lane's data
// source. Keys are the pristine paths, so a renamed/moved account simply
// loses its badge until the next Reset (fine for a demo readout).
const postingCountsCache = new Map<WorkloadName, Map<string, number>>();

function getPostingCounts(name: WorkloadName): Map<string, number> {
  let counts = postingCountsCache.get(name);
  if (counts == null) {
    counts = new Map();
    for (const entry of getEntries(name)) {
      for (const posting of entry.postings) {
        counts.set(posting.account, (counts.get(posting.account) ?? 0) + 1);
      }
    }
    postingCountsCache.set(name, counts);
  }
  return counts;
}

function isDropCollision(value: string): value is AccountDropCollision {
  return value === 'reject' || value === 'skip' || value === 'replace';
}

// Minimal native menu proving the context-menu composition contract: the
// tree emits requests (right-click / Shift+F10 / row "…" button); the host
// renders the menu and calls request.close() — default restores focus to
// the row, `restoreFocus: false` is the rename handoff.
let accountMenu: HTMLElement | undefined;
let accountMenuOutsideHandler: ((event: PointerEvent) => void) | undefined;

// Single teardown path for every dismissal (Escape, Rename handoff, outside
// click, superseding open): removes the menu AND its document-level outside
// listener, so a stale handler can never dismiss a newer menu.
function destroyAccountMenu(): void {
  if (accountMenuOutsideHandler != null) {
    document.removeEventListener(
      'pointerdown',
      accountMenuOutsideHandler,
      true
    );
    accountMenuOutsideHandler = undefined;
  }
  accountMenu?.remove();
  accountMenu = undefined;
}

function openAccountContextMenu(request: AccountTreeContextMenuRequest): void {
  destroyAccountMenu(); // A newer session supersedes the previous menu.
  const point =
    'rect' in request.anchor
      ? { x: request.anchor.rect.left, y: request.anchor.rect.bottom }
      : request.anchor;
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.style.cssText =
    `position: fixed; left: ${point.x}px; top: ${point.y}px; z-index: 30;` +
    'min-width: 160px; padding: 4px; border-radius: 8px;' +
    'background: light-dark(#fff, #171717);' +
    'border: 1px solid light-dark(#d4d4d4, #333); font-size: 13px;';

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.setAttribute('role', 'menuitem');
  rename.textContent = `Rename ${request.path.split(':').at(-1)}`;
  rename.style.cssText =
    'display: block; width: 100%; padding: 5px 8px; border: 0;' +
    'background: none; color: inherit; text-align: left; cursor: pointer;';
  rename.addEventListener('click', () => {
    const path = request.path;
    request.close({ restoreFocus: false }); // The rename handoff.
    destroyAccountMenu();
    accountTree?.beginRename(path);
  });
  menu.appendChild(rename);

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      request.close(); // Focus returns to the originating row.
      destroyAccountMenu();
    }
  });
  // Any outside pointerdown dismisses the menu (and restores tree focus).
  // Registered in shared state so destroyAccountMenu removes it on EVERY
  // dismissal path, not just this one.
  const onOutside = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    request.close();
    destroyAccountMenu();
  };
  accountMenuOutsideHandler = onOutside;
  document.addEventListener('pointerdown', onOutside, true);

  document.body.appendChild(menu);
  menu.focus();
  accountMenu = menu;
  accountsReadout.textContent = `menu on ${request.paths.join(', ')} (${request.source})`;
}

// Fake async chart source for the lazy-loading demo: two groups start
// unloaded; expanding 'Archive:Old-Ledgers' resolves child accounts after a
// 600ms fake fetch, while 'Archive:Flaky-Import' always rejects so the error
// row + Retry affordance stays reproducible.
function fakeLoadChildren(path: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (path === 'Archive:Flaky-Import') {
        reject(new Error('import source unreachable'));
      } else {
        resolve([`${path}:2023`, `${path}:2024`, `${path}:2025`]);
      }
    }, 600);
  });
}

// (Re)creates the account tree for the current workload/density/flatten
// selection. Renames and drops mutate the instance's internal remapped
// entries; the Reset button simply rebuilds from the pristine workload.
function renderAccountTree(): void {
  accountTree?.cleanUp();
  const workload = isWorkloadName(workloadSelect.value)
    ? workloadSelect.value
    : DEFAULT_WORKLOAD;
  const postingCounts = getPostingCounts(workload);
  accountTree = new AccountTree({
    entries: getEntries(workload),
    // Lazy-loading showcase: the Archive subtree exists only as unloaded
    // stubs — expand them to watch the loading row, the fetched children,
    // and (on Flaky-Import) the error row with Retry.
    accounts: ['Archive:Old-Ledgers', 'Archive:Flaky-Import'],
    initiallyUnloaded: ['Archive:Old-Ledgers', 'Archive:Flaky-Import'],
    loadChildren: fakeLoadChildren,
    onChildLoadError(path, error) {
      accountsReadout.textContent = `loading ${path} failed: ${
        error instanceof Error ? error.message : String(error)
      } — use Retry on the row`;
    },
    currency: 'MYR',
    density: densitySelect.value === 'compact' ? 'compact' : 'default',
    initialExpansion: 'top-level',
    flattenEmptyGroups: flattenToggle.checked,
    colorScheme: currentScheme,
    // Built-in icon set via the default top-level heuristics resolver.
    icons: { resolver: createDefaultAccountIconResolver() },
    // Host decoration lane: a posting-count badge on leaves with activity.
    renderDecorations({ path, isGroup }) {
      if (isGroup) {
        return [];
      }
      const count = postingCounts.get(path);
      return count == null
        ? []
        : [{ kind: 'text', text: `${count}×`, tone: 'neutral' }];
    },
    dropCollision: isDropCollision(treeCollisionSelect.value)
      ? treeCollisionSelect.value
      : 'reject',
    onSelect(selectedPaths, focusedPath) {
      accountsReadout.textContent =
        selectedPaths.length === 0
          ? 'No account selected.'
          : `selected ${selectedPaths.join(', ')} · focused ${focusedPath ?? '—'}`;
    },
    onRename(oldPath, newPath) {
      console.log('account renamed', oldPath, newPath);
      accountsReadout.textContent = `renamed ${oldPath} → ${newPath}`;
    },
    onMove(moves) {
      console.log('accounts moved', moves);
      accountsReadout.textContent = `moved ${describeMoves(moves)}`;
    },
    // Fires after onMove with the strategy breakdown (skipped / replaced).
    onDropComplete({ moves, skipped, replaced }) {
      const parts = [`moved ${describeMoves(moves)}`];
      if (skipped.length > 0) {
        parts.push(`skipped ${describeMoves(skipped)}`);
      }
      if (replaced.length > 0) {
        parts.push(`replaced ${replaced.join(', ')}`);
      }
      accountsReadout.textContent = parts.join(' · ');
    },
    onDropError({ reason, attempted }) {
      accountsReadout.textContent =
        attempted.length > 0
          ? `drop ${reason}: ${describeMoves(attempted)}`
          : `drop ${reason}`;
    },
    contextMenu: {
      rowButton: true,
      onOpen: openAccountContextMenu,
    },
    // v2 view features: stacked sticky ancestor breadcrumb and measured
    // middle truncation for deep names (full name lands in `title`).
    stickyAncestors: 'stack',
    nameTruncation: 'middle',
  });
  accountTree.render(accountsHost);
  syncTreeSearch();
}

// Flatten is a live projection toggle on the existing instance — no rebuild.
flattenToggle.addEventListener('change', () => {
  accountTree?.setFlattenEmptyGroups(flattenToggle.checked);
});

// dropCollision is a constructor option; the demo rebuilds the tree so the
// selected strategy also re-reads cleanly after renames/moves mutated it.
treeCollisionSelect.addEventListener('change', () => {
  renderAccountTree();
  accountsReadout.textContent = `drop collision strategy: ${treeCollisionSelect.value}`;
});

treeReset.addEventListener('click', () => {
  renderAccountTree();
  accountsReadout.textContent = 'Tree reset. No account selected.';
});

// --- Chart of accounts: search session ---------------------------------------

function isSearchMode(value: string): value is AccountTreeSearchMode {
  return (
    value === 'expand-matches' ||
    value === 'collapse-non-matches' ||
    value === 'hide-non-matches'
  );
}

function updateTreeSearchReadout(): void {
  const state = accountTree?.getController().getSearchMatchState() ?? null;
  treeSearchState.textContent =
    state == null ? '–' : `${state.index}/${state.total}`;
}

// (Re)applies the input + mode select onto the controller's search session:
// a non-empty query begins/refines the session, an emptied input ends it and
// restores the pre-search expansion. Rebuilding the tree (workload/reset)
// re-applies whatever the input still holds.
function syncTreeSearch(): void {
  const controller = accountTree?.getController();
  if (controller == null) {
    return;
  }
  const query = treeSearchInput.value.trim();
  const mode = isSearchMode(treeSearchMode.value)
    ? treeSearchMode.value
    : 'expand-matches';
  if (query === '') {
    controller.endSearch();
  } else {
    controller.beginSearch(query, { mode });
  }
  updateTreeSearchReadout();
}

// Steps the focused match and reveals it — the same controller calls a host
// search input is expected to make (F3/Shift+F3 do this from the tree).
function stepTreeSearchMatch(direction: 1 | -1): void {
  const controller = accountTree?.getController();
  if (controller == null) {
    return;
  }
  const path =
    direction === 1
      ? controller.focusNextSearchMatch()
      : controller.focusPreviousSearchMatch();
  if (path != null) {
    accountTree?.scrollToPath(path, { focus: true });
  }
  updateTreeSearchReadout();
}

treeSearchInput.addEventListener('input', syncTreeSearch);
treeSearchMode.addEventListener('change', syncTreeSearch);
treeSearchNext.addEventListener('click', () => stepTreeSearchMatch(1));
treeSearchPrev.addEventListener('click', () => stepTreeSearchMatch(-1));

// --- Reconciliation ----------------------------------------------------------

// The reconciliation demo is a static handcrafted fixture (statement page vs
// cash book); it renders once and its readout narrates every accept /
// reject / undo / create-entry event plus the live difference.
function renderReconciliation(): void {
  const reconciliation = new Reconciliation({
    account: RECONCILIATION_ACCOUNT,
    periodLabel: RECONCILIATION_PERIOD,
    statementLines: RECONCILIATION_STATEMENT_LINES,
    postings: RECONCILIATION_POSTINGS,
    onAccept(match) {
      reportReconciliation(`accepted ${match.id}`, reconciliation);
    },
    onReject(match) {
      reportReconciliation(`rejected ${match.id}`, reconciliation);
    },
    onUndo(match) {
      reportReconciliation(`undid ${match.id}`, reconciliation);
    },
    onCreateEntry(line) {
      reportReconciliation(
        `create entry requested for "${line.description}" (${formatMinorUnits(
          line.amount,
          line.currency,
          { sign: 'always' }
        )} ${line.currency})`,
        reconciliation
      );
    },
  });
  reconciliation.render({ parentNode: reconciliationHost });
  reportReconciliation('proposals ready', reconciliation);
}

function reportReconciliation(
  event: string,
  reconciliation: Reconciliation
): void {
  const { matches, difference } = reconciliation.getState();
  const accepted = matches.filter(
    (match) => match.status === 'accepted'
  ).length;
  const differenceText = [...difference.entries()]
    .map(
      ([currency, amount]) =>
        `${formatMinorUnits(amount, currency)} ${currency}`
    )
    .join(' · ');
  reconciliationReadout.textContent =
    `${event} — ${accepted}/${matches.length} accepted · ` +
    `difference ${differenceText === '' ? '0.00' : differenceText}`;
}

// --- Financial statements ------------------------------------------------------

let trialBalanceView: TrialBalance | undefined;
let incomeStatementView: IncomeStatement | undefined;
let balanceSheetView: BalanceSheet | undefined;

// The generated chart follows the default five-root convention, so the stock
// taxonomy classifies every workload account. One override demonstrates the
// escape hatch: marketplace commissions are contra revenue — an income
// account whose normal balance is debit — so classifying it contra keeps the
// P&L presentation right (a negative income line) and stops the abnormal-
// balance flag from firing on correct data. One shared instance across
// workloads: classification is path-based and memoized per taxonomy.
const statementsTaxonomy = createAccountTaxonomy({
  overrides: {
    'Income:Sales:Marketplace-Commissions': { contra: true },
  },
});

// Distinct calendar years present in the entries, ascending. The statement
// demos compare the last two, so comparative columns always carry real data
// regardless of the workload's generated date span.
function getEntryYears(entries: readonly LedgerEntry[]): string[] {
  const years = new Set<string>();
  for (const entry of entries) {
    years.add(entry.date.slice(0, 4));
  }
  return [...years].sort();
}

// Derives and renders all three statements from the current workload's
// entries. Components are created once and re-rendered with fresh derived
// data (the data-reference fast path makes redundant renders free); the
// readout narrates the two proofs — the trial balance tie and the
// accounting equation — which hold on every generated workload because the
// generator only emits balanced entries.
function renderStatements(entries: readonly LedgerEntry[]): void {
  const years = getEntryYears(entries).slice(-2);
  if (years.length === 0) {
    statementsReadout.textContent = 'No entries to derive statements from.';
    return;
  }
  const periods: StatementPeriod[] = years.map((year) => ({
    label: `FY${year}`,
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
  }));
  const dates: StatementDate[] = years.map((year) => ({
    label: `31 Dec ${year}`,
    asOf: `${year}-12-31`,
    fiscalYearStart: `${year}-01-01`,
  }));
  const lastYear = years[years.length - 1];

  const trialBalanceData = deriveTrialBalance(entries, {
    taxonomy: statementsTaxonomy,
    asOf: `${lastYear}-12-31`,
  });
  trialBalanceView ??= new TrialBalance({});
  trialBalanceView.render({
    data: trialBalanceData,
    parentNode: trialBalanceHost,
  });

  const incomeStatementData = deriveIncomeStatement(entries, {
    periods,
    taxonomy: statementsTaxonomy,
  });
  incomeStatementView ??= new IncomeStatement({});
  incomeStatementView.render({
    data: incomeStatementData,
    parentNode: incomeStatementHost,
  });

  const balanceSheetData = deriveBalanceSheet(entries, {
    dates,
    taxonomy: statementsTaxonomy,
  });
  balanceSheetView ??= new BalanceSheet({});
  balanceSheetView.render({
    data: balanceSheetData,
    parentNode: balanceSheetHost,
  });

  const rowCount = trialBalanceData.sections.reduce(
    (total, section) => total + section.rows.length,
    0
  );
  const tie = trialBalanceData.sections.every((section) => section.balanced);
  const equation = balanceSheetData.sections.every((section) =>
    section.balancedByDate.every(Boolean)
  );
  statementsReadout.textContent =
    `${rowCount.toLocaleString('en-MY')} trial balance rows · ` +
    `debits ${tie ? '=' : '≠'} credits · ` +
    `accounting equation ${equation ? 'holds' : 'BROKEN'} · ` +
    `columns ${years.map((year) => `FY${year}`).join(' / ')}`;
}

// Rebuilds every data-driven view for the current workload/density selection
// and refreshes the toolbar stats line.
function rebuildDataViews(): void {
  const workload = isWorkloadName(workloadSelect.value)
    ? workloadSelect.value
    : DEFAULT_WORKLOAD;
  const density: RegisterDensity =
    densitySelect.value === 'compact' ? 'compact' : 'comfortable';
  const store = getStore(workload);
  const registerRows = buildRegisterRows(store, REGISTER_ACCOUNT);
  renderRegister(registerRows, density);
  renderLedgerView(store, density);
  renderAccountTree();
  renderStatements(getEntries(workload));
  registerReadout.textContent = 'No row selected.';
  ledgerReadout.textContent = 'No row selected.';
  accountsReadout.textContent = 'No account selected.';
  workloadStats.textContent =
    `${store.getEntryCount().toLocaleString('en-MY')} entries · ` +
    `${registerRows.length.toLocaleString('en-MY')} register rows`;
}

// The selector only offers the heavyweight workload when the CRAZY_LEDGER
// toggle is on, so casual dev-server starts never pay for 100k entries.
function populateWorkloadSelect(): void {
  const names: WorkloadName[] = CRAZY_LEDGER
    ? ['small', 'medium', 'large']
    : ['small', 'medium'];
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = `${name} (${WORKLOAD_ENTRY_COUNTS[name].toLocaleString('en-MY')})`;
    workloadSelect.appendChild(option);
  }
  workloadSelect.value = DEFAULT_WORKLOAD;
}

workloadSelect.addEventListener('change', rebuildDataViews);
densitySelect.addEventListener('change', rebuildDataViews);

// --- Boot ----------------------------------------------------------------------

// connectThemeController already themed the stage at creation; boot only
// syncs the pieces the subscriber handles on later changes.
populateThemeSelect();
setChromeScheme(currentScheme);
renderEntryGallery();
renderEntryDiff();
renderEntryStream();
renderReconciliation();
populateWorkloadSelect();
rebuildDataViews();
