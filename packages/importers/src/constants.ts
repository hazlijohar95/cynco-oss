// The canonical ISO 4217 minor-unit exponent table lives in the engine —
// one definition for the whole suite. Re-exported under the names this
// package has always offered: `CURRENCY_DECIMALS` is the engine's
// `DEFAULT_CURRENCY_EXPONENTS`, and `getCurrencyDecimals` is the engine's
// `getCurrencyExponent` (which additionally accepts caller overrides).
export {
  DEFAULT_CURRENCY_EXPONENTS as CURRENCY_DECIMALS,
  getCurrencyExponent as getCurrencyDecimals,
} from '@cynco/ledger-core';
