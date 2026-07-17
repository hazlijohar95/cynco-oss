import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, red, yellow, green, jade, cyan, blue, indigo, pink } =
  palettes;

// Soft variants compress contrast one notch: backgrounds lift off pure
// near-black, foregrounds drop below pure near-white, and ledger tokens move
// from the 400 ramp steps to 300.
export const darkSoft: Roles = {
  bg: {
    editor: neutral['1000'],
    window: neutral['980'],
    inset: neutral['960'],
    elevated: neutral['1020'],
  },
  fg: {
    base: neutral['200'],
    fg1: neutral['300'],
    fg2: neutral['400'],
    fg3: neutral['600'],
    fg4: neutral['700'],
  },
  border: {
    window: neutral['1000'],
    editor: neutral['960'],
    indentGuide: neutral['960'],
    indentGuideActive: neutral['940'],
    inset: neutral['960'],
    elevated: neutral['960'],
  },
  accent: {
    primary: blue['400'],
    link: blue['400'],
    subtle: blue['950'],
    contrastOnAccent: neutral['1040'],
  },
  states: {
    match: indigo['400'],
    success: jade['400'],
    danger: red['400'],
    warn: yellow['400'],
    info: cyan['400'],
  },
  ledger: {
    debit: green['300'],
    credit: red['300'],
    balance: neutral['300'],
    balanceNegative: red['300'],
    date: neutral['400'],
    payee: neutral['200'],
    narration: neutral['400'],
    account: blue['300'],
    currency: neutral['600'],
    tag: cyan['300'],
    link: indigo['300'],
    reconciled: jade['300'],
    pending: yellow['300'],
    flagged: pink['300'],
    void: neutral['700'],
  },
};
