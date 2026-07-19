import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, amber, teal, cyan, blue, indigo, vermillion, magenta } =
  palettes;

// CVD variant safe for tritanopia (blue-yellow blindness; the axis that truly
// collapses is blue <-> green). Debit/credit and success/danger ride the
// red <-> cyan/teal axis tritanopia preserves. Chrome (bg/fg/border/accent)
// is identical to `dark`; only semantic colors move. Enforced by
// test/cvd.gate.test.ts.
export const darkTritan: Roles = {
  bg: {
    editor: neutral['1040'],
    window: neutral['1000'],
    inset: neutral['980'],
    elevated: neutral['1020'],
  },
  fg: {
    base: neutral['020'],
    fg1: neutral['200'],
    fg2: neutral['400'],
    fg3: neutral['600'],
    fg4: neutral['700'],
  },
  border: {
    window: neutral['1040'],
    editor: neutral['980'],
    indentGuide: neutral['980'],
    indentGuideActive: neutral['960'],
    inset: neutral['980'],
    elevated: neutral['980'],
  },
  accent: {
    primary: blue['500'],
    link: blue['500'],
    subtle: blue['950'],
    contrastOnAccent: neutral['1040'],
  },
  states: {
    match: magenta['500'],
    success: teal['500'],
    danger: vermillion['500'],
    warn: amber['500'],
    info: blue['500'],
  },
  ledger: {
    debit: teal['400'],
    credit: vermillion['400'],
    balance: neutral['200'],
    balanceNegative: vermillion['400'],
    date: neutral['400'],
    payee: neutral['020'],
    narration: neutral['400'],
    account: blue['400'],
    currency: neutral['600'],
    tag: cyan['400'],
    link: indigo['400'],
    reconciled: teal['400'],
    pending: amber['400'],
    flagged: magenta['400'],
    void: neutral['700'],
  },
};
