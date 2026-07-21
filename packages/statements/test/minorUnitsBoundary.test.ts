import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { renderBalanceSheetHTML } from '../src/renderers/BalanceSheetRenderer';
import { renderIncomeStatementHTML } from '../src/renderers/IncomeStatementRenderer';
import { renderTrialBalanceHTML } from '../src/renderers/TrialBalanceRenderer';
import type {
  BalanceSheetData,
  IncomeStatementData,
  TrialBalanceData,
} from '../src/types';
import {
  isValidMinorUnits,
  resetInvalidMinorUnitsWarnings,
  warnInvalidMinorUnits,
} from '../src/utils/minorUnitsBoundary';

// The warn dedupe is module-level (once per context) so every test starts
// from a clean slate; the spy swallows output to keep the test log honest.
let errorSpy = spyOn(console, 'error');

beforeEach(() => {
  resetInvalidMinorUnitsWarnings();
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// Hand-built statement data (the shapes a host could construct without
// going through the derive* functions, which already skip unsafe amounts).
function makeTrialBalance(balance: number): TrialBalanceData {
  return {
    asOf: null,
    sections: [
      {
        currency: 'MYR',
        rows: [
          {
            account: 'Assets:Cash',
            classification: null,
            balance,
            unadjusted: null,
            adjustment: null,
            abnormal: false,
          },
        ],
        totalDebit: balance,
        totalCredit: 0,
        balanced: false,
        hasOverflow: false,
      },
    ],
  };
}

function makeIncomeStatement(amount: number): IncomeStatementData {
  return {
    periods: [
      { label: 'FY2026', dateFrom: '2026-01-01', dateTo: '2026-12-31' },
    ],
    sections: [
      {
        currency: 'MYR',
        income: [],
        expenses: [],
        totalIncome: [amount],
        totalExpenses: [0],
        netIncome: [amount],
        unclassified: [{ account: 'Income:Sales', amounts: [amount] }],
        hasOverflow: false,
      },
    ],
  };
}

function makeBalanceSheet(amount: number): BalanceSheetData {
  return {
    dates: [{ label: '31 Dec 2026', asOf: '2026-12-31' }],
    sections: [
      {
        currency: 'MYR',
        assets: [],
        liabilities: [],
        equity: [],
        retainedEarnings: [0],
        currentEarnings: [0],
        totalAssets: [amount],
        totalLiabilities: [0],
        totalEquity: [0],
        balancedByDate: [false],
        unclassified: [{ account: 'Assets:Cash', amounts: [amount] }],
        hasOverflow: false,
      },
    ],
  };
}

describe('isValidMinorUnits', () => {
  test('accepts safe integers, rejects floats and non-finite values', () => {
    expect(isValidMinorUnits(1250)).toBe(true);
    expect(isValidMinorUnits(-4550)).toBe(true);
    expect(isValidMinorUnits(12.5)).toBe(false);
    expect(isValidMinorUnits(Number.NaN)).toBe(false);
    expect(isValidMinorUnits(2 ** 53)).toBe(false);
  });
});

describe('warnInvalidMinorUnits', () => {
  test('fires once per context, with the actionable conversion hint', () => {
    warnInvalidMinorUnits('TestContext', 12.5);
    warnInvalidMinorUnits('TestContext', 99.9);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0]);
    expect(message).toContain('integer minor units');
    expect(message).toContain('1250');
  });
});

describe('renderer boundaries', () => {
  test('valid data produces no warning in any renderer', () => {
    renderTrialBalanceHTML(makeTrialBalance(150_000));
    renderIncomeStatementHTML(makeIncomeStatement(150_000));
    renderBalanceSheetHTML(makeBalanceSheet(150_000));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a float amount warns once per renderer, not once per call', () => {
    renderTrialBalanceHTML(makeTrialBalance(12.5));
    renderTrialBalanceHTML(makeTrialBalance(99.9));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    renderIncomeStatementHTML(makeIncomeStatement(12.5));
    renderIncomeStatementHTML(makeIncomeStatement(99.9));
    expect(errorSpy).toHaveBeenCalledTimes(2);
    renderBalanceSheetHTML(makeBalanceSheet(12.5));
    renderBalanceSheetHTML(makeBalanceSheet(99.9));
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  test('rendered bytes are identical whether or not the warning fires', () => {
    // First render fires the warning, the second is deduped: the string
    // output must be byte-identical — the check is a console side channel
    // only, preserving the renderer byte-parity contract.
    const trialBalance = makeTrialBalance(12.5);
    const tbWithWarning = renderTrialBalanceHTML(trialBalance);
    const tbSuppressed = renderTrialBalanceHTML(trialBalance);
    expect(tbSuppressed).toBe(tbWithWarning);

    const incomeStatement = makeIncomeStatement(12.5);
    const isWithWarning = renderIncomeStatementHTML(incomeStatement);
    const isSuppressed = renderIncomeStatementHTML(incomeStatement);
    expect(isSuppressed).toBe(isWithWarning);

    const balanceSheet = makeBalanceSheet(12.5);
    const bsWithWarning = renderBalanceSheetHTML(balanceSheet);
    const bsSuppressed = renderBalanceSheetHTML(balanceSheet);
    expect(bsSuppressed).toBe(bsWithWarning);

    expect(errorSpy).toHaveBeenCalledTimes(3);
  });
});
