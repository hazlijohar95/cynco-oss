export type Roles = {
  bg: {
    editor: string; // main ledger background (brightest in light, darkest in dark)
    window: string; // sidebar, header, status bar, inactive panels
    inset: string; // inputs, dropdowns
    elevated: string; // panels, hover backgrounds
  };
  fg: { base: string; fg1: string; fg2: string; fg3: string; fg4: string };
  border: {
    window: string; // borders for sidebar, header, status bar
    editor: string; // general ledger borders
    indentGuide: string; // account tree indent guide lines
    indentGuideActive: string; // active indent guide line
    inset: string; // borders for inputs, dropdowns
    elevated: string; // borders for panels
  };
  accent: {
    primary: string;
    link: string;
    subtle: string;
    contrastOnAccent: string;
  };
  states: {
    match: string; // reconciliation match candidate
    success: string;
    danger: string;
    warn: string;
    info: string;
  };
  ledger: {
    // Amount semantics mirror diff semantics: a debit posting increases the
    // account (added line), a credit posting decreases it (deleted line).
    debit: string;
    credit: string;
    balance: string; // running balance at rest
    balanceNegative: string; // running balance below zero
    date: string;
    payee: string;
    narration: string;
    account: string;
    currency: string; // currency/commodity codes
    tag: string; // #tags on entries
    link: string; // ^links between entries
    reconciled: string; // cleared/reconciled marker
    pending: string; // pending marker
    flagged: string; // flagged for review
    void: string; // voided entries
  };
};
