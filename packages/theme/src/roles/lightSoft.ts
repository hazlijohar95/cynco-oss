import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, red, yellow, green, jade, cyan, blue, indigo, pink } =
  palettes;

// Soft variants compress contrast one notch: the editor background drops off
// pure white and foregrounds ease up from pure near-black.
export const lightSoft: Roles = {
  bg: {
    editor: neutral['020'],
    window: neutral['080'],
    inset: neutral['100'],
    elevated: neutral['060'],
  },
  fg: {
    base: neutral['1000'],
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
    primary: blue['600'],
    link: blue['600'],
    subtle: blue['100'],
    contrastOnAccent: '#ffffff',
  },
  states: {
    match: indigo['600'],
    success: jade['600'],
    danger: red['600'],
    warn: yellow['600'],
    info: cyan['600'],
  },
  ledger: {
    debit: green['600'],
    credit: red['600'],
    balance: neutral['800'],
    balanceNegative: red['600'],
    date: neutral['600'],
    payee: neutral['1000'],
    narration: neutral['600'],
    account: blue['600'],
    currency: neutral['500'],
    tag: cyan['600'],
    link: indigo['600'],
    reconciled: jade['600'],
    pending: yellow['600'],
    flagged: pink['600'],
    void: neutral['400'],
  },
};
