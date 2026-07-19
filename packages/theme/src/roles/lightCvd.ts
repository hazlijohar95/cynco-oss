import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, yellow, cyan, blue, indigo, orange, violet } = palettes;

// CVD variant safe for protanopia AND deuteranopia (red-green blindness, the
// most common color vision deficiencies). Debit/credit and success/danger
// ride the blue <-> orange axis both deficiencies preserve, instead of the
// base theme's green <-> red axis. Chrome (bg/fg/border/accent) is identical
// to `light`; only semantic colors move. Enforced by test/cvd.gate.test.ts.
export const lightCvd: Roles = {
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
    match: indigo['600'],
    success: blue['700'],
    danger: orange['700'],
    warn: yellow['700'],
    info: cyan['700'],
  },
  ledger: {
    debit: blue['700'],
    credit: orange['700'],
    balance: neutral['900'],
    balanceNegative: orange['700'],
    date: neutral['600'],
    payee: neutral['1040'],
    narration: neutral['600'],
    account: blue['600'],
    currency: neutral['500'],
    tag: cyan['700'],
    link: indigo['600'],
    reconciled: blue['700'],
    pending: yellow['700'],
    flagged: violet['600'],
    void: neutral['500'],
  },
};
