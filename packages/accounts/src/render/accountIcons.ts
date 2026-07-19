// Built-in, dependency-free account icon set: SVG *path data only* (16×16
// viewBox, drawn for `fill="currentColor"` with `fill-rule="evenodd"` so
// ring/cutout subpaths punch holes). The renderer builds the surrounding
// `<svg aria-hidden="true">` element itself.
//
// SECURITY: this record is the XSS boundary of the icon system. Resolvers
// return an `AccountIconName` (a closed union), NEVER markup; the renderer
// only interpolates path data looked up HERE, and validates the returned
// name against this record first (untyped JS hosts can return arbitrary
// strings). Host-provided HTML never reaches the icon lane.

import type { AccountIconName } from '../types';

export const ACCOUNT_ICON_PATHS: Readonly<Record<AccountIconName, string>> = {
  // Classical bank building: pediment, four columns, base slab.
  bank:
    'M8 1.5 14.5 5v1.5h-13V5L8 1.5ZM2.5 13h11v1.5h-11V13Zm1-5.5h2V12h-2V7.5Z' +
    'm3.5 0h2V12H7V7.5Zm3.5 0h2V12h-2V7.5Z',
  // Banknote: outer ring (evenodd cutout) with a center coin.
  cash:
    'M1 4.5h14v7H1v-7Zm1.5 1.5v4h11V6h-11Z' +
    'M8 6.75A1.25 1.25 0 1 1 8 9.25 1.25 1.25 0 0 1 8 6.75Z',
  // Wallet: rounded body with a clasp cutout on the right edge.
  wallet:
    'M1.5 5A2 2 0 0 1 3.5 3h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5Z' +
    'M10.25 7.25h4.25v2.5h-4.25a1.25 1.25 0 0 1 0-2.5Z',
  // Incoming arrow over a tray: money owed TO the entity arrives.
  receivable:
    'M7.25 1.5h1.5v5.94l2-2 1.06 1.06L8 10.31 4.19 6.5 5.25 5.44l2 2V1.5Z' +
    'M2 11h3.25L6.5 12.25h3L10.75 11H14v3.5H2V11Z',
  // Outgoing arrow over a tray: money owed BY the entity leaves.
  payable:
    'M8 1.69 11.81 5.5 10.75 6.56l-2-2v5.94h-1.5V4.56l-2 2L4.19 5.5 8 1.69Z' +
    'M2 11h3.25L6.5 12.25h3L10.75 11H14v3.5H2V11Z',
  // Trend line up with an arrowhead into the top-right corner.
  income:
    'M9.5 2.5H14V7h-1.5V5.06L8.75 8.81l-2.5-2.5-3.72 3.72-1.06-1.06 4.78-4.78 ' +
    '2.5 2.5 2.69-2.69H9.5V2.5ZM1.5 12.5h13V14h-13v-1.5Z',
  // Trend line down with an arrowhead into the bottom-right corner.
  expense:
    'M9.5 12.5H14V8h-1.5v1.94L8.75 6.19l-2.5 2.5-3.72-3.72-1.06 1.06 4.78 4.78 ' +
    '2.5-2.5 2.69 2.69H9.5v1.5ZM1.5 1.5h13V3h-13V1.5Z',
  // Pie: three-quarter disc plus a detached upper-left quarter wedge.
  equity: 'M8 1.5A6.5 6.5 0 1 1 1.5 8H8V1.5Z' + 'M6.5 0.5v6h-6a6 6 0 0 1 6-6Z',
  // Folder with a tab.
  folder:
    'M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11' +
    'a1 1 0 0 1-1-1V3.5Z',
  // Three ascending bars.
  chart: 'M2 9h2.5v4.5H2V9Zm4.75-4h2.5v8.5h-2.5V5Zm4.75-2.5H14v11h-2.5v-11Z',
};
