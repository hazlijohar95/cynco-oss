import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, amber, teal, cyan, blue, indigo, vermillion, magenta } =
  palettes;

// CVD variant safe for tritanopia (blue-yellow blindness; the axis that truly
// collapses is blue <-> green). Debit/credit and success/danger ride the
// red <-> cyan/teal axis tritanopia preserves. Chrome (bg/fg/border/accent)
// is identical to `light`; only semantic colors move. Enforced by
// test/cvd.gate.test.ts.
export const lightTritan: Roles = {
  bg: {
    editor: '#ffffff',
    window: neutral['060'],
    inset: neutral['080'],
    elevated: neutral['040'],
  },
  fg: {
    base: neutral['1040'],
    fg1: neutral['900'],
    fg2: neutral['800'],
    fg3: neutral['600'],
    fg4: neutral['500'],
  },
  border: {
    window: neutral['100'],
    editor: neutral['200'],
    indentGuide: neutral['100'],
    indentGuideActive: neutral['200'],
    inset: neutral['200'],
    elevated: neutral['100'],
  },
  accent: {
    primary: blue['500'],
    link: blue['500'],
    subtle: blue['100'],
    contrastOnAccent: '#ffffff',
  },
  states: {
    match: magenta['600'],
    success: teal['700'],
    danger: vermillion['600'],
    warn: amber['700'],
    info: blue['600'],
  },
  ledger: {
    debit: teal['700'],
    credit: vermillion['600'],
    balance: neutral['900'],
    balanceNegative: vermillion['600'],
    date: neutral['600'],
    payee: neutral['1040'],
    narration: neutral['600'],
    account: blue['600'],
    currency: neutral['500'],
    tag: cyan['700'],
    link: indigo['600'],
    reconciled: teal['700'],
    pending: amber['700'],
    flagged: magenta['600'],
    void: neutral['500'],
  },
};
