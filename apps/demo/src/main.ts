import {
  formatMinorUnits,
  JournalEntry,
  journalsThemeVariables,
  LedgerView,
  Reconciliation,
  Register,
  type RegisterDensity,
  type RegisterRowData,
} from '@cynco/journals';
import { EntryStore, isEntryBalanced } from '@cynco/ledger-store';
import {
  WORKLOAD_ENTRY_COUNTS,
  type WorkloadName,
  workloads,
} from '@cynco/ledger-test-data';
import { dark, darkSoft, light, lightSoft, type Roles } from '@cynco/theme';

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

const DEFAULT_WORKLOAD: WorkloadName = CRAZY_LEDGER ? 'large' : 'medium';
const DEFAULT_THEME: ThemeName = 'dark';
const REGISTER_ACCOUNT = 'Assets:Current:Cash-Maybank';
const LEDGER_VIEW_ACCOUNTS: readonly string[] = [
  'Assets:Current:Cash-Maybank',
  'Assets:Current:AR',
  'Income:Sales:Services-Consulting',
  'Expenses:Payroll:Salaries',
  'Liabilities:Current:SST-Payable',
];

// --- Themes ------------------------------------------------------------------

type ThemeName = 'dark' | 'light' | 'darkSoft' | 'lightSoft';

interface ThemeSpec {
  roles: Roles;
  scheme: 'dark' | 'light';
}

const THEMES: Record<ThemeName, ThemeSpec> = {
  dark: { roles: dark, scheme: 'dark' },
  light: { roles: light, scheme: 'light' },
  darkSoft: { roles: darkSoft, scheme: 'dark' },
  lightSoft: { roles: lightSoft, scheme: 'light' },
};

function isThemeName(value: string): value is ThemeName {
  return Object.hasOwn(THEMES, value);
}

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
const ledgerHost = mustGetElement('ledger-host', HTMLElement);
const ledgerReadout = mustGetElement('ledger-readout', HTMLElement);
const reconciliationHost = mustGetElement('reconciliation-host', HTMLElement);
const reconciliationReadout = mustGetElement(
  'reconciliation-readout',
  HTMLElement
);

// --- Theme / chrome controls -------------------------------------------------

let appliedThemeVariables: readonly string[] = [];

// Applies a theme to the stage wrapper: @cynco/theme roles become
// `--journals-theme-*` inline variables (every <journals-container> beneath
// reads them), and `color-scheme` pins light-dark() resolution inside the
// components. The page chrome class follows along so the two start in sync.
function applyTheme(name: ThemeName): void {
  const { roles, scheme } = THEMES[name];
  for (const property of appliedThemeVariables) {
    stage.style.removeProperty(property);
  }
  const variables = journalsThemeVariables(roles);
  for (const [property, value] of Object.entries(variables)) {
    stage.style.setProperty(property, value);
  }
  appliedThemeVariables = Object.keys(variables);
  stage.style.setProperty('color-scheme', scheme);
  setChromeScheme(scheme);
}

// Flips the page chrome (html class drives page colors and light-dark()
// fallbacks) independently of the component theme, to demonstrate that the
// theme variables pin component colors regardless of the page scheme.
function setChromeScheme(scheme: 'dark' | 'light'): void {
  document.documentElement.className = scheme;
  chromeToggle.textContent = `Chrome: ${scheme}`;
}

themeSelect.value = DEFAULT_THEME;
themeSelect.addEventListener('change', () => {
  if (isThemeName(themeSelect.value)) {
    applyTheme(themeSelect.value);
  }
});

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

// (Re)creates the standalone Register. Density affects both CSS row height
// and the JS window math, so density changes rebuild the instance instead of
// mutating options in place.
function renderRegister(
  rows: RegisterRowData[],
  density: RegisterDensity
): void {
  register?.cleanUp();
  register = new Register({
    account: REGISTER_ACCOUNT,
    density,
    onRowSelect(row, index) {
      console.log('register row selected', index, row);
      registerReadout.textContent = describeRow(row, index);
    },
  });
  register.render({ rows, parentNode: registerHost });
}

// (Re)creates the multi-account LedgerView over a handful of accounts from
// the generated chart, all behind one shared virtualizer.
function renderLedgerView(store: EntryStore, density: RegisterDensity): void {
  ledgerView?.cleanUp();
  ledgerView = new LedgerView({
    density,
    onRowSelect(account, row, index) {
      console.log('ledger view row selected', account, index, row);
      ledgerReadout.textContent = `${account} · ${describeRow(row, index)}`;
    },
  });
  const sections = LEDGER_VIEW_ACCOUNTS.map((account) => ({
    account,
    rows: buildRegisterRows(store, account),
  }));
  ledgerView.render({ sections, parentNode: ledgerHost });
}

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
  registerReadout.textContent = 'No row selected.';
  ledgerReadout.textContent = 'No row selected.';
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

applyTheme(DEFAULT_THEME);
renderEntryGallery();
renderReconciliation();
populateWorkloadSelect();
rebuildDataViews();
