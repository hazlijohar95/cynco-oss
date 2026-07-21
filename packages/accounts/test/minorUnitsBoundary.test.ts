import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { AccountTreeController } from '../src/model/AccountTreeController';
import { renderAccountRowsHTML } from '../src/render/AccountTreeRenderer';
import type { LedgerEntry } from '../src/types';
import {
  isValidMinorUnits,
  resetInvalidMinorUnitsWarnings,
  warnInvalidMinorUnits,
} from '../src/utils/minorUnitsBoundary';
import { CHART_ACCOUNTS, makeChartEntries } from './domHarness';

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

/** Chart entries with one float posting amount (major-units mistake). */
function makeFloatEntries(): LedgerEntry[] {
  const entries = makeChartEntries();
  const [first, ...rest] = entries;
  const [posting, ...postings] = first.postings;
  return [
    {
      ...first,
      postings: [{ ...posting, amount: 12.5 }, ...postings],
    },
    ...rest,
  ];
}

function projectTree(entries: readonly LedgerEntry[]): string {
  const controller = new AccountTreeController({
    entries,
    accounts: CHART_ACCOUNTS,
  });
  const count = controller.getVisibleCount();
  return renderAccountRowsHTML(
    controller.getRows(0, count),
    { start: 0, end: count },
    { currency: 'MYR', idPrefix: 'acct-boundary' }
  );
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

describe('AccountTreeController boundary', () => {
  test('valid entries produce no warning', () => {
    projectTree(makeChartEntries());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a float amount warns once across construction and setEntries', () => {
    const controller = new AccountTreeController({
      entries: makeFloatEntries(),
      accounts: CHART_ACCOUNTS,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // A fresh bad array re-enters buildStore but the context already warned.
    controller.setEntries(makeFloatEntries());
    // So does a second controller over the same bad data.
    projectTree(makeFloatEntries());
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('rendered bytes are identical whether or not the warning fires', () => {
    const htmlWithWarning = projectTree(makeFloatEntries());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Second controller over the same data: the warning is deduped, the
    // output must not change — the check is a console side channel only.
    const htmlSuppressed = projectTree(makeFloatEntries());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(htmlSuppressed).toBe(htmlWithWarning);
    expect(htmlWithWarning).not.toBe('');
  });
});
