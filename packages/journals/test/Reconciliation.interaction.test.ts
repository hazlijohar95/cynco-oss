import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  Reconciliation,
  type ReconciliationOptions,
} from '../src/components/Reconciliation';
import type { ReconciliationMatch, StatementLine } from '../src/types';
import {
  type DomHandle,
  installDom,
  makeBookPosting,
  makeStatementLine,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const ACCOUNT = 'Assets:Current:Cash-Maybank';

interface Harness {
  instance: Reconciliation;
  section(): HTMLElement;
  clickAction(action: string, id?: string): void;
  events: string[];
  cleanUp(): void;
}

// Fully-matchable fixture: two lines, two postings, both pair exactly, so
// accepting everything drives the difference to zero.
function makeFullyMatchedOptions(
  events: string[],
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
    onAccept(match: ReconciliationMatch) {
      events.push(`accept:${match.id}:${match.status}`);
    },
    onReject(match: ReconciliationMatch) {
      events.push(`reject:${match.id}:${match.status}`);
    },
    onUndo(match: ReconciliationMatch) {
      events.push(`undo:${match.id}:${match.status}`);
    },
    onCreateEntry(line: StatementLine) {
      events.push(`create:${line.id}`);
    },
    ...overrides,
  };
}

function createHarness(
  options: ReconciliationOptions,
  events: string[] = []
): Harness {
  const instance = new Reconciliation(options);
  instance.render({ parentNode: document.body });
  const container = document.querySelector('journals-container');
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
    events,
    section,
    clickAction(action: string, id?: string) {
      let selector = `[data-recon-action="${action}"]`;
      if (id != null) {
        selector +=
          action === 'create-entry'
            ? `[data-line-id="${id}"]`
            : `[data-match-id="${id}"]`;
      }
      const button = section().querySelector(selector);
      if (!(button instanceof HTMLElement)) {
        throw new Error(`clickAction: no button for ${action} ${id ?? ''}`);
      }
      button.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, composed: true })
      );
    },
    cleanUp() {
      instance.cleanUp();
    },
  };
}

describe('Reconciliation interaction', () => {
  test('accepting every match drives the difference to exactly zero', () => {
    const events: string[] = [];
    const harness = createHarness(makeFullyMatchedOptions(events), events);

    // Both pairs proposed; difference = statement total (10800) − 0.
    expect(harness.instance.getState().difference.get('MYR')).toBe(10_800);

    harness.clickAction('accept', 'm-s1-e1-0');
    expect(harness.instance.getState().difference.get('MYR')).toBe(-4_200);

    harness.clickAction('accept', 'm-s2-e2-0');
    const state = harness.instance.getState();
    expect(state.difference.get('MYR')).toBe(0);
    expect(state.matches.every((match) => match.status === 'accepted')).toBe(
      true
    );

    // The header verdict flips to the reconciled state.
    const difference = harness
      .section()
      .querySelector('[data-recon-figure="difference"]');
    expect(difference?.getAttribute('data-difference')).toBe('zero');
    expect(difference?.querySelector('[data-recon-dot]')).not.toBeNull();
    harness.cleanUp();
  });

  test('rejecting dissolves the pair into unmatched rows on both sides', () => {
    const harness = createHarness(makeFullyMatchedOptions([]));
    expect(
      harness.section().querySelectorAll('[data-row-type="pair"]').length
    ).toBe(2);

    harness.clickAction('reject', 'm-s1-e1-0');
    const section = harness.section();
    expect(section.querySelectorAll('[data-row-type="pair"]').length).toBe(1);
    expect(
      section.querySelectorAll('[data-row-type="statement-only"]').length
    ).toBe(1);
    expect(section.querySelectorAll('[data-row-type="book-only"]').length).toBe(
      1
    );
    expect(
      harness.instance
        .getState()
        .matches.find((match) => match.id === 'm-s1-e1-0')?.status
    ).toBe('rejected');
    harness.cleanUp();
  });

  test('undo restores an accepted match to proposed', () => {
    const harness = createHarness(makeFullyMatchedOptions([]));
    harness.instance.acceptMatch('m-s1-e1-0');
    expect(
      harness
        .section()
        .querySelector('[data-match-id="m-s1-e1-0"]')
        ?.getAttribute('data-match-status')
    ).toBe('accepted');

    harness.clickAction('undo', 'm-s1-e1-0');
    expect(
      harness
        .section()
        .querySelector('[data-match-id="m-s1-e1-0"]')
        ?.getAttribute('data-match-status')
    ).toBe('proposed');
    expect(harness.instance.getState().difference.get('MYR')).toBe(10_800);
    harness.cleanUp();
  });

  test('callbacks fire with the transitioned match / clicked line', () => {
    const events: string[] = [];
    const harness = createHarness(
      makeFullyMatchedOptions(events, {
        statementLines: [
          makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
          makeStatementLine({ id: 's9', date: '2026-07-09', amount: 777 }),
        ],
        postings: [
          makeBookPosting({
            entryId: 'e1',
            date: '2026-07-02',
            amount: 15_000,
          }),
        ],
      }),
      events
    );

    harness.clickAction('accept', 'm-s1-e1-0');
    harness.clickAction('undo', 'm-s1-e1-0');
    harness.clickAction('reject', 'm-s1-e1-0');
    harness.clickAction('create-entry', 's9');
    expect(harness.events).toEqual([
      'accept:m-s1-e1-0:accepted',
      'undo:m-s1-e1-0:proposed',
      'reject:m-s1-e1-0:rejected',
      'create:s9',
    ]);
    harness.cleanUp();
  });

  test('imperative transitions are idempotent and ignore unknown ids', () => {
    const events: string[] = [];
    const harness = createHarness(makeFullyMatchedOptions(events), events);
    harness.instance.acceptMatch('m-s1-e1-0');
    harness.instance.acceptMatch('m-s1-e1-0'); // no-op, no second callback
    harness.instance.acceptMatch('nonsense'); // no-op
    expect(harness.events).toEqual(['accept:m-s1-e1-0:accepted']);
    harness.cleanUp();
  });
});

describe('Reconciliation interaction with sum matches', () => {
  test('accept/undo difference math treats the group atomically', () => {
    const events: string[] = [];
    const harness = createHarness(
      makeFullyMatchedOptions(events, {
        statementLines: [
          makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
        ],
        postings: [
          makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 9_000 }),
          makeBookPosting({ entryId: 'e2', date: '2026-07-02', amount: 6_000 }),
        ],
      }),
      events
    );
    const state = harness.instance.getState();
    expect(state.matches.length).toBe(1);
    expect(state.matches[0].kind).toBe('sum');
    const matchId = state.matches[0].id;
    expect(state.difference.get('MYR')).toBe(15_000);

    harness.clickAction('accept', matchId);
    expect(harness.instance.getState().difference.get('MYR')).toBe(0);
    const verdict = harness
      .section()
      .querySelector('[data-recon-figure="difference"]');
    expect(verdict?.getAttribute('data-difference')).toBe('zero');

    harness.clickAction('undo', matchId);
    expect(harness.instance.getState().difference.get('MYR')).toBe(15_000);
    expect(harness.events).toEqual([
      `accept:${matchId}:accepted`,
      `undo:${matchId}:proposed`,
    ]);
    harness.cleanUp();
  });
});
