import {
  dark,
  darkCvd,
  darkSoft,
  darkTritan,
  light,
  lightCvd,
  lightSoft,
  lightTritan,
} from '@cynco/theme';

import { createThemeCatalog } from './createThemeCatalog';
import type { ThemeCatalog } from './types';

// Ready-made catalog covering every role set @cynco/theme ships, so hosts
// that don't author custom themes get the full picker (including the
// colorblind-safe and tritan-safe variants) with one import. Entry names
// deliberately match the @cynco/theme export names ('lightSoft', 'darkCvd',
// …) so code can move between the two packages without a rename table.
export const defaultCatalog: ThemeCatalog = createThemeCatalog(
  [
    { name: 'light', label: 'Light', scheme: 'light', roles: light },
    { name: 'dark', label: 'Dark', scheme: 'dark', roles: dark },
    {
      name: 'lightSoft',
      label: 'Light (soft)',
      scheme: 'light',
      roles: lightSoft,
    },
    { name: 'darkSoft', label: 'Dark (soft)', scheme: 'dark', roles: darkSoft },
    {
      name: 'lightCvd',
      label: 'Light (colorblind-safe)',
      scheme: 'light',
      roles: lightCvd,
    },
    {
      name: 'darkCvd',
      label: 'Dark (colorblind-safe)',
      scheme: 'dark',
      roles: darkCvd,
    },
    {
      name: 'lightTritan',
      label: 'Light (tritan-safe)',
      scheme: 'light',
      roles: lightTritan,
    },
    {
      name: 'darkTritan',
      label: 'Dark (tritan-safe)',
      scheme: 'dark',
      roles: darkTritan,
    },
  ],
  { light: 'light', dark: 'dark' }
);
