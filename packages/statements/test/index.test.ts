import { describe, expect, test } from 'bun:test';

import {
  createAccountTaxonomy,
  deriveTrialBalance,
  getCurrencyExponent,
  type LedgerEntry,
  renderTrialBalanceHTML,
} from '../src/index';

// Smoke test for the public surface: the engine derivations and the
// renderers must be reachable from one import so the derive → render DX
// works end to end.
describe('@cynco/statements public API', () => {
  test('deriveTrialBalance re-export produces sections that render', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'e1',
        date: '2026-06-15',
        flag: 'cleared',
        payee: 'Acme Sdn Bhd',
        narration: 'Consulting invoice',
        tags: [],
        links: [],
        postings: [
          { account: 'Assets:Cash', amount: 150_000, currency: 'MYR' },
          { account: 'Income:Sales', amount: -150_000, currency: 'MYR' },
        ],
      },
    ];
    const data = deriveTrialBalance(entries, {
      taxonomy: createAccountTaxonomy(),
    });
    expect(data.sections.length).toBe(1);
    expect(data.sections[0].balanced).toBe(true);
    const html = renderTrialBalanceHTML(data);
    expect(html).toContain('data-trial-balance');
    expect(html).toContain('1,500.00');
  });

  test('currency registry re-export answers minor-unit exponents', () => {
    expect(getCurrencyExponent('MYR')).toBe(2);
    expect(getCurrencyExponent('JPY')).toBe(0);
    expect(getCurrencyExponent('BHD')).toBe(3);
  });
});
