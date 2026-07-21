import type { MinorUnits } from '../types';

/**
 * Negates a minor-unit amount without ever producing IEEE `-0`: unary minus
 * on `0` yields `-0`, which serializes as `0` but fails `Object.is` equality
 * and renders as `-0.00` through some formatters. Subtraction from zero
 * normalizes it (the same idiom as ledger-core's `negateMinorUnits`).
 */
export function negateMinorUnits(amount: MinorUnits): MinorUnits {
  return 0 - amount;
}
