/**
 * ISO 4217 minor-unit exceptions. Currencies not listed here use 2 decimal
 * places. Commodity codes (stock tickers, points) also fall back to 2.
 *
 * MUST mirror `DEFAULT_CURRENCY_EXPONENTS` in
 * `@cynco/ledger-core/src/currency.ts` — the engine's canonical table.
 * importers deliberately carries no runtime dependency on the engine, so the
 * table is duplicated here (journals does the same); a partial copy of the
 * journals mirror once drifted (5 exceptions vs the engine's ~26) and
 * mis-scaled zero- and three-decimal currencies 100×/10× relative to
 * `@cynco/statements`. test/lockstepParity.test.ts asserts this copy stays
 * entry-identical with the journals mirror.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
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

/** Minor-unit decimal places for a currency code; unknown codes use 2. */
export function getCurrencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}
