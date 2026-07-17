import { palettes } from '../palettes';
import type { Roles } from './Roles';

const { neutral, red, yellow, green, jade, cyan, blue, indigo, pink } =
  palettes;

export const light: Roles = {
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
    success: jade['600'],
    danger: red['600'],
    warn: yellow['600'],
    info: cyan['600'],
  },
  ledger: {
    debit: green['600'],
    credit: red['600'],
    balance: neutral['900'],
    balanceNegative: red['600'],
    date: neutral['600'],
    payee: neutral['1040'],
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
