import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EntryStream } from '../src/components/EntryStream';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { LedgerEntry } from '../src/types';
import { createEntryStreamFromArray } from '../src/utils/createEntryStreamFromArray';
import { type DomHandle, installDom, makeEntry, wait } from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

function makeEntries(count: number): LedgerEntry[] {
  return Array.from({ length: count }, (_, index) =>
    makeEntry({ id: `stream-${index}`, payee: `Payee ${index}` })
  );
}

interface Harness {
  instance: EntryStream;
  shadowRoot: ShadowRoot;
  region(): HTMLElement | null;
  cleanUp(): void;
}

function createHarness(instance: EntryStream): Harness {
  // Each harness gets its own parent node and queries WITHIN it. Querying
  // document-wide (the old shape) made tests read each other's DOM: a test
  // failing before its cleanUp() left its container behind, and the next
  // test's document.querySelector grabbed the stale instance — which is
  // exactly how a completion announcement from test 1 once showed up in
  // test 2's assertions on a loaded CI runner.
  const parent = document.createElement('div');
  document.body.append(parent);
  instance.render({ parentNode: parent });
  const container = parent.querySelector(JOURNALS_TAG_NAME);
  const shadowRoot =
    container instanceof HTMLElement ? container.shadowRoot : null;
  if (shadowRoot == null) {
    throw new Error('createHarness: stream skeleton missing');
  }
  return {
    instance,
    shadowRoot,
    region() {
      const element = shadowRoot.querySelector('[data-live-region]');
      return element instanceof HTMLElement ? element : null;
    },
    cleanUp() {
      instance.cleanUp();
      parent.remove();
    },
  };
}

// Settle by quiescence, not fixed sleeps (test/README.md known-gaps table:
// fixed waits race multi-stage async pipelines on loaded CI runners).
// Deadline-bounded so a broken stream still fails fast.
async function waitUntilDone(instance: EntryStream): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!instance.isDone() && Date.now() < deadline) {
    await wait(10);
  }
  // One tick for the completion announcement to commit after done flips.
  await wait(0);
}

describe('EntryStream announcements', () => {
  test('announces stream start, then completion — and nothing in between', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(5), { delayMs: 15 }),
    });
    const harness = createHarness(instance);
    const region = harness.region();
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.className).toBe('visually-hidden');
    // Created empty; the start announcement lands on the next frame (the
    // region must exist in the tree before its content changes).
    expect(region?.textContent).toBe('');
    let mutations = 0;
    const observer = new dom.window.MutationObserver((records) => {
      mutations += records.length;
    });
    if (region != null) {
      observer.observe(region, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    await wait(0);
    expect(region?.textContent).toBe('Streaming entries\u2026');
    // No fixed-time mid-stream assertion: on a loaded runner the stream's
    // chained timeouts can lag past any sleep we pick (this exact test
    // failed in CI with isDone() still false after 110ms of waits). The
    // "nothing in between" claim is carried by the mutation count below —
    // exactly two announcements means the region held the start message for
    // the whole stream, no timing window required.
    await waitUntilDone(harness.instance);
    expect(harness.instance.isDone()).toBe(true);
    expect(region?.textContent).toBe('5 entries loaded');
    // Exactly two announcements across the whole stream lifetime.
    expect(mutations).toBe(2);
    observer.disconnect();
    harness.cleanUp();
  });

  test('completion pluralizes honestly for a single entry', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(1), { delayMs: 10 }),
    });
    const harness = createHarness(instance);
    await waitUntilDone(instance);
    expect(harness.region()?.textContent).toBe('1 entry loaded');
    harness.cleanUp();
  });

  test('the rapidly-updating visual footer is not a live region', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(3)),
      total: 3,
    });
    const harness = createHarness(instance);
    await wait(20);
    const footer = harness.shadowRoot.querySelector('[data-stream-footer]');
    expect(footer).not.toBeNull();
    // Verified rather than assumed: neither the footer nor anything inside
    // it carries aria-live/role="status", so the per-flush count updates
    // are never separately announced — only the region's two moments are.
    expect(footer?.hasAttribute('aria-live')).toBe(false);
    expect(footer?.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(footer?.closest('[aria-live]')).toBeNull();
    harness.cleanUp();
  });
});
