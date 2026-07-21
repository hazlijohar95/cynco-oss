import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';

import { JournalEntry } from '../src/components/JournalEntry';
import { Register } from '../src/components/Register';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { RegisterRowData } from '../src/types';
import {
  isValidMinorUnits,
  resetInvalidMinorUnitsWarnings,
  warnInvalidMinorUnits,
} from '../src/utils/minorUnitsBoundary';
import { type DomHandle, installDom, makeEntry, makeRows } from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

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

/** makeRows output with one float amount injected (major-units mistake). */
function makeFloatRows(count: number, floatIndex: number): RegisterRowData[] {
  const rows = makeRows(count);
  const target = rows[floatIndex];
  rows[floatIndex] = {
    ...target,
    posting: { ...target.posting, amount: 12.5 },
  };
  return rows;
}

function renderRegister(rows: readonly RegisterRowData[]): string {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({ account: 'Assets:Current:Cash-Maybank' });
  register.render({ rows, container, parentNode: document.body });
  const html = container.shadowRoot?.innerHTML ?? '';
  register.cleanUp();
  container.remove();
  // Row ids embed a per-instance counter (`register-<n>-row-*`) that
  // legitimately differs between instances; normalize it so the byte
  // comparison isolates the warning's (absence of) effect on output.
  return html.replaceAll(/register-\d+-row-/g, 'register-N-row-');
}

describe('isValidMinorUnits', () => {
  test('accepts safe integers, rejects floats and non-finite values', () => {
    expect(isValidMinorUnits(1250)).toBe(true);
    expect(isValidMinorUnits(0)).toBe(true);
    expect(isValidMinorUnits(-4550)).toBe(true);
    expect(isValidMinorUnits(12.5)).toBe(false);
    expect(isValidMinorUnits(Number.NaN)).toBe(false);
    expect(isValidMinorUnits(Number.POSITIVE_INFINITY)).toBe(false);
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
    expect(message).toContain('12.5');
    expect(message).toContain('1250');
  });
});

describe('Register boundary', () => {
  test('valid rows produce no warning', () => {
    renderRegister(makeRows(20));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a float amount warns once, not once per row or per setRows', () => {
    const container = document.createElement(JOURNALS_TAG_NAME);
    const register = new Register({ account: 'Assets:Current:Cash-Maybank' });
    register.render({
      rows: makeFloatRows(20, 3),
      container,
      parentNode: document.body,
    });
    // A fresh (different-reference) bad array re-enters the boundary check
    // but the context already warned.
    register.setRows(makeFloatRows(20, 5));
    register.cleanUp();
    container.remove();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('rendered bytes are identical whether or not the warning fires', () => {
    const rows = makeFloatRows(20, 3);
    const htmlWithWarning = renderRegister(rows);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Second render over the same data: the warning is deduped, the output
    // must not change — the check is a console side channel only.
    const htmlSuppressed = renderRegister(rows);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(htmlSuppressed).toBe(htmlWithWarning);
    expect(htmlWithWarning).not.toBe('');
  });
});

describe('JournalEntry boundary', () => {
  test('valid entries produce no warning', () => {
    const entry = makeEntry();
    const journalEntry = new JournalEntry();
    journalEntry.render({ entry, parentNode: document.body });
    journalEntry.cleanUp();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a float posting warns once and leaves rendered bytes identical', () => {
    const entry = makeEntry({
      postings: [
        {
          account: 'Assets:Current:Cash-Maybank',
          amount: 12.5,
          currency: 'MYR',
        },
        { account: 'Income:Sales:Consulting', amount: -12.5, currency: 'MYR' },
      ],
    });

    const first = new JournalEntry();
    const firstContainer = document.createElement(JOURNALS_TAG_NAME);
    first.render({
      entry,
      container: firstContainer,
      parentNode: document.body,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const htmlWithWarning = firstContainer.shadowRoot?.innerHTML ?? '';

    const second = new JournalEntry();
    const secondContainer = document.createElement(JOURNALS_TAG_NAME);
    second.render({
      entry,
      container: secondContainer,
      parentNode: document.body,
    });
    // Deduped: still exactly one warning across both instances.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const htmlSuppressed = secondContainer.shadowRoot?.innerHTML ?? '';

    expect(htmlSuppressed).toBe(htmlWithWarning);
    expect(htmlWithWarning).not.toBe('');
    first.cleanUp();
    second.cleanUp();
  });
});
