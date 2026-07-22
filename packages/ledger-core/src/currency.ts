// Currency minor-unit exponents. The engine stores every amount as integer
// minor units; the exponent (how many decimal places the minor unit
// represents) is the one piece of currency metadata correctness depends on —
// RM 12.34 is the integer 1234 only because MYR has exponent 2, while ¥1234
// is 1234 whole yen (exponent 0) and BHD 1.234 is 1234 fils (exponent 3).
// Assuming 2 everywhere silently mis-scales those currencies, so the
// canonical table lives here in the engine and consumers ask instead of
// assuming.

/**
 * ISO 4217 currencies whose minor-unit exponent is not 2. Every currency
 * absent from this table uses the common 2-decimal convention. Commodities
 * and unknown codes also fall back to 2 — graceful degradation over
 * throwing, consistent with the suite's parser rules; callers with exotic
 * commodities pass explicit overrides instead.
 *
 * This is the one canonical table for the whole suite: every package
 * (journals, accounts, statements, importers) imports it from here — never
 * copy it, a partial hand-copy once mis-scaled zero- and three-decimal
 * currencies 100×/10× in production.
 */
export const DEFAULT_CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  // Zero-decimal currencies: the minor unit is the whole unit.
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // Three-decimal currencies (mils/fils).
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // Four-decimal funds codes.
  CLF: 4,
  UYW: 4,
};

/**
 * Minor-unit exponent for a currency or commodity code: the number of
 * decimal places one minor unit sits below the whole unit. Resolution order
 * is caller overrides, then {@link DEFAULT_CURRENCY_EXPONENTS}, then 2.
 * Malformed override values (negative, fractional, non-finite) are ignored
 * rather than propagated — an exponent must be a small non-negative integer
 * or every downstream digit-string computation breaks.
 */
export function getCurrencyExponent(
  currency: string,
  overrides?: Readonly<Record<string, number>>
): number {
  const candidate =
    overrides?.[currency] ?? DEFAULT_CURRENCY_EXPONENTS[currency];
  if (candidate != null && Number.isInteger(candidate) && candidate >= 0) {
    return candidate;
  }
  return 2;
}
