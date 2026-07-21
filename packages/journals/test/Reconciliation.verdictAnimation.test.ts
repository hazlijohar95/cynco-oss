import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  Reconciliation,
  type ReconciliationOptions,
} from '../src/components/Reconciliation';
import { JOURNALS_TAG_NAME } from '../src/constants';
import {
  type DomHandle,
  installDom,
  makeBookPosting,
  makeStatementLine,
  wait,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const ACCOUNT = 'Assets:Current:Cash-Maybank';

// Comfortably past RECON_VERDICT_LEAVE_MS (180) plus the leading rAF: long
// enough that the deferred commit has always landed, short enough to keep
// the suite fast.
const COMMIT_WAIT_MS = 250;

// Fully-matchable fixture (the interaction suite's shape): two exact pairs.
function makeOptions(
  overrides: Partial<ReconciliationOptions> = {}
): ReconciliationOptions {
  return {
    account: ACCOUNT,
    periodLabel: 'Jul 2026',
    statementLines: [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
      makeStatementLine({ id: 's2', date: '2026-07-05', amount: -4_200 }),
    ],
    postings: [
      makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-05', amount: -4_200 }),
    ],
    ...overrides,
  };
}

interface Harness {
  instance: Reconciliation;
  shadowRoot: ShadowRoot;
  section(): HTMLElement;
  rowsOfType(type: string): Element[];
  cleanUp(): void;
}

function createHarness(options: ReconciliationOptions): Harness {
  const instance = new Reconciliation(options);
  instance.render({ parentNode: document.body });
  const container = document.querySelector(JOURNALS_TAG_NAME);
  if (!(container instanceof HTMLElement) || container.shadowRoot == null) {
    throw new Error('createHarness: container missing');
  }
  const shadowRoot = container.shadowRoot;
  const section = (): HTMLElement => {
    const element = shadowRoot.querySelector('[data-reconciliation]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('createHarness: section missing');
    }
    return element;
  };
  return {
    instance,
    shadowRoot,
    section,
    rowsOfType(type: string) {
      return Array.from(
        section().querySelectorAll(`[data-row-type="${type}"]`)
      );
    },
    cleanUp() {
      instance.cleanUp();
    },
  };
}

// Temporarily forces `(prefers-reduced-motion: reduce)` to match. jsdom's
// matchMedia always reports false, so the animated path is the default in
// tests and this override is the only way to exercise the reduced path.
function withReducedMotion(run: () => void): void {
  const original = dom.window.matchMedia;
  dom.window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof dom.window.matchMedia;
  try {
    run();
  } finally {
    dom.window.matchMedia = original;
  }
}

describe('Reconciliation verdict animation', () => {
  test('reject marks the pair data-leaving, then commits the dissolve after the animation', async () => {
    const harness = createHarness(makeOptions());
    expect(harness.rowsOfType('pair').length).toBe(2);

    harness.instance.rejectMatch('m-s1-e1-0');
    // State flips synchronously — only the DOM commit is deferred.
    expect(
      harness.instance
        .getState()
        .matches.find((match) => match.id === 'm-s1-e1-0')?.status
    ).toBe('rejected');
    const leaving = harness
      .section()
      .querySelector('[data-match-id="m-s1-e1-0"]');
    expect(leaving?.hasAttribute('data-leaving')).toBe(true);
    // The pair row is still materialized while it animates out.
    expect(harness.rowsOfType('pair').length).toBe(2);

    await wait(COMMIT_WAIT_MS);
    expect(harness.rowsOfType('pair').length).toBe(1);
    expect(harness.rowsOfType('statement-only').length).toBe(1);
    expect(harness.rowsOfType('book-only').length).toBe(1);
    // The rows the verdict introduced fade in via data-entering.
    expect(
      harness.rowsOfType('statement-only')[0]?.hasAttribute('data-entering')
    ).toBe(true);
    expect(
      harness.rowsOfType('book-only')[0]?.hasAttribute('data-entering')
    ).toBe(true);
    harness.cleanUp();
  });

  test('prefers-reduced-motion commits the verdict synchronously', () => {
    const harness = createHarness(makeOptions());
    withReducedMotion(() => {
      harness.instance.rejectMatch('m-s1-e1-0');
      // No deferred commit: the dissolve is already in the DOM, and no row
      // is left mid-animation.
      expect(harness.rowsOfType('pair').length).toBe(1);
      expect(harness.rowsOfType('statement-only').length).toBe(1);
      expect(harness.rowsOfType('book-only').length).toBe(1);
      expect(harness.section().querySelector('[data-leaving]')).toBeNull();
    });
    harness.cleanUp();
  });

  test('a second verdict mid-animation jumps the first straight to its final state', async () => {
    const harness = createHarness(makeOptions());
    harness.instance.rejectMatch('m-s1-e1-0');
    expect(harness.rowsOfType('pair').length).toBe(2); // first still animating

    harness.instance.rejectMatch('m-s2-e2-0');
    // The first verdict flushed instantly (its pair is gone); the second is
    // now the only one animating.
    expect(
      harness.section().querySelector('[data-match-id="m-s1-e1-0"]')
    ).toBeNull();
    expect(
      harness
        .section()
        .querySelector('[data-match-id="m-s2-e2-0"]')
        ?.hasAttribute('data-leaving')
    ).toBe(true);
    expect(harness.rowsOfType('pair').length).toBe(1);

    await wait(COMMIT_WAIT_MS);
    expect(harness.rowsOfType('pair').length).toBe(0);
    expect(harness.rowsOfType('statement-only').length).toBe(2);
    expect(harness.rowsOfType('book-only').length).toBe(2);
    // No queue buildup: exactly one section, committed exactly once.
    expect(
      harness.shadowRoot.querySelectorAll('[data-reconciliation]').length
    ).toBe(1);
    harness.cleanUp();
  });

  test('a data change mid-animation drops the deferred commit — no late rebuild', async () => {
    const harness = createHarness(makeOptions());
    harness.instance.rejectMatch('m-s1-e1-0');
    expect(harness.section().querySelector('[data-leaving]')).not.toBeNull();

    // Fresh options with fresh data references: the documented data-change
    // signal. This re-derives matches and rebuilds instantly.
    const options = makeOptions();
    options.statementLines = [...options.statementLines];
    harness.instance.setOptions(options);
    const sectionAfterDataChange = harness.section();
    expect(sectionAfterDataChange.querySelector('[data-leaving]')).toBeNull();

    // The canceled verdict commit must never land later and rebuild again.
    await wait(COMMIT_WAIT_MS);
    expect(harness.section()).toBe(sectionAfterDataChange);
    harness.cleanUp();
  });

  test('undo of a rejection animates the unmatched halves out and fades the pair back in', async () => {
    const harness = createHarness(makeOptions());
    harness.instance.rejectMatch('m-s1-e1-0');
    await wait(COMMIT_WAIT_MS);
    expect(harness.rowsOfType('pair').length).toBe(1);

    harness.instance.undoMatch('m-s1-e1-0');
    // Both released halves animate out together.
    expect(harness.section().querySelectorAll('[data-leaving]').length).toBe(2);
    await wait(COMMIT_WAIT_MS);
    const restored = harness
      .section()
      .querySelector('[data-match-id="m-s1-e1-0"]');
    expect(restored?.getAttribute('data-match-status')).toBe('proposed');
    expect(restored?.hasAttribute('data-entering')).toBe(true);
    expect(harness.rowsOfType('statement-only').length).toBe(0);
    expect(harness.rowsOfType('book-only').length).toBe(0);
    harness.cleanUp();
  });

  test('accept and undo-of-accepted keep their row and commit instantly', () => {
    const harness = createHarness(makeOptions());
    harness.instance.acceptMatch('m-s1-e1-0');
    // The pair survives an accept, so there is nothing to animate out and
    // the rebuild is synchronous (the pre-existing behavior every accept
    // test in the suite relies on).
    expect(
      harness
        .section()
        .querySelector('[data-match-id="m-s1-e1-0"]')
        ?.getAttribute('data-match-status')
    ).toBe('accepted');
    expect(harness.section().querySelector('[data-leaving]')).toBeNull();
    harness.instance.undoMatch('m-s1-e1-0');
    expect(
      harness
        .section()
        .querySelector('[data-match-id="m-s1-e1-0"]')
        ?.getAttribute('data-match-status')
    ).toBe('proposed');
    expect(harness.section().querySelector('[data-leaving]')).toBeNull();
    harness.cleanUp();
  });
});
