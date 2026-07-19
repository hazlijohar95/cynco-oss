import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  Reconciliation,
  type ReconciliationOptions,
} from '../src/components/Reconciliation';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { preloadReconciliationHTML } from '../src/ssr/preloadReconciliation';
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

// Fully-matchable fixture (the interaction suite's shape): two exact pairs,
// so accepting everything drives the difference to zero.
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
  region(): HTMLElement | null;
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
  return {
    instance,
    shadowRoot,
    region() {
      const element = shadowRoot.querySelector('[data-live-region]');
      return element instanceof HTMLElement ? element : null;
    },
    cleanUp() {
      instance.cleanUp();
    },
  };
}

describe('Reconciliation announcements', () => {
  test('a polite, visually hidden region mounts empty outside the section', () => {
    const harness = createHarness(makeOptions());
    const region = harness.region();
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.className).toBe('visually-hidden');
    // Empty at mount: nothing to (re)announce on load or hydration.
    expect(region?.textContent).toBe('');
    // A stable SIBLING of the re-rendered section, never inside it.
    expect(region?.parentNode).toBe(harness.shadowRoot);
    expect(region?.closest('[data-reconciliation]')).toBeNull();
    harness.cleanUp();
  });

  test('accept, reject, and undo each announce the resulting difference', () => {
    const harness = createHarness(makeOptions());
    // Statement total 10800; accepting the 15000 pair leaves −4200.
    harness.instance.acceptMatch('m-s1-e1-0');
    expect(harness.region()?.textContent).toBe('MYR difference \u221242.00');
    harness.instance.acceptMatch('m-s2-e2-0');
    expect(harness.region()?.textContent).toBe('All currencies reconciled');
    harness.instance.undoMatch('m-s1-e1-0');
    expect(harness.region()?.textContent).toBe('MYR difference 150.00');
    harness.instance.rejectMatch('m-s1-e1-0');
    // Rejection releases the pair; only s2 stays cleared.
    expect(harness.region()?.textContent).toBe('MYR difference 150.00');
    harness.cleanUp();
  });

  test('one announcement per discrete state change — no storms', async () => {
    const harness = createHarness(makeOptions());
    const region = harness.region();
    if (region == null) {
      throw new Error('region missing');
    }
    let mutations = 0;
    const observer = new dom.window.MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Two transitions in one multi-step sequence → exactly two text writes
    // (transitionMatch is the single mutation entry point; each transition
    // re-renders once, announces once).
    harness.instance.acceptMatch('m-s1-e1-0');
    harness.instance.acceptMatch('m-s2-e2-0');
    await wait(0);
    expect(mutations).toBe(2);
    // Idempotent re-accepts are not state changes and must stay silent.
    harness.instance.acceptMatch('m-s1-e1-0');
    harness.instance.acceptMatch('nonsense');
    await wait(0);
    expect(mutations).toBe(2);
    observer.disconnect();
    harness.cleanUp();
  });

  test('disableAnnouncements renders no region at all', () => {
    const harness = createHarness(makeOptions({ disableAnnouncements: true }));
    expect(harness.region()).toBeNull();
    harness.instance.acceptMatch('m-s1-e1-0');
    expect(harness.region()).toBeNull();
    harness.cleanUp();
  });

  test('the region survives whole-section re-renders as the same node', () => {
    const harness = createHarness(makeOptions());
    const region = harness.region();
    const sectionBefore = harness.shadowRoot.querySelector(
      '[data-reconciliation]'
    );
    harness.instance.acceptMatch('m-s1-e1-0'); // Replaces the section.
    const sectionAfter = harness.shadowRoot.querySelector(
      '[data-reconciliation]'
    );
    expect(sectionAfter).not.toBe(sectionBefore);
    expect(harness.region()).toBe(region as HTMLElement);
    expect(region?.isConnected).toBe(true);
    harness.cleanUp();
  });

  test('hydration creates the region empty — SSR output replays nothing', async () => {
    const options = makeOptions();
    const ssrHTML = await preloadReconciliationHTML({
      account: options.account,
      statementLines: options.statementLines,
      postings: options.postings,
    });
    const container = document.createElement(JOURNALS_TAG_NAME);
    const shadowRoot = container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = ssrHTML;
    document.body.appendChild(container);
    // SSR markup carries no live region — announcements are client state.
    expect(shadowRoot.querySelector('[data-live-region]')).toBeNull();
    const instance = new Reconciliation(options, true);
    instance.hydrate({ container });
    const region = shadowRoot.querySelector('[data-live-region]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
    instance.acceptMatch('m-s1-e1-0');
    expect(region?.textContent).toBe('MYR difference \u221242.00');
    instance.cleanUp();
    container.remove();
  });
});
