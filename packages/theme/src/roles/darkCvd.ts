import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, yellow, cyan, blue, indigo, orange, violet } = palettes;

// CVD variant safe for protanopia AND deuteranopia (red-green blindness, the
// most common color vision deficiencies). Debit/credit and success/danger
// ride the blue <-> orange axis both deficiencies preserve, instead of the
// base theme's green <-> red axis. Chrome (bg/fg/border/accent) is identical
// to `dark`; only semantic colors move. Enforced by test/cvd.gate.test.ts.
export const darkCvd: Roles = {
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
    match: indigo['500'],
    success: blue['500'],
    danger: orange['500'],
    warn: yellow['500'],
    info: cyan['500'],
  },
  ledger: {
    debit: blue['400'],
    credit: orange['400'],
    balance: neutral['200'],
    balanceNegative: orange['400'],
    date: neutral['400'],
    payee: neutral['020'],
    narration: neutral['400'],
    account: blue['400'],
    currency: neutral['600'],
    tag: cyan['400'],
    link: indigo['400'],
    reconciled: blue['400'],
    pending: yellow['400'],
    flagged: violet['400'],
    void: neutral['700'],
  },
};
