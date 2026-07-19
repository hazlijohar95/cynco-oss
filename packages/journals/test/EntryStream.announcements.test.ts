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
  instance.render({ parentNode: document.body });
  const container = document.querySelector(JOURNALS_TAG_NAME);
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
    },
  };
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
    // Mid-stream: entries keep arriving and the visual footer counts up,
    // but the region holds exactly the start message.
    await wait(30);
    expect(harness.instance.isDone()).toBe(false);
    expect(region?.textContent).toBe('Streaming entries\u2026');
    await wait(80);
    expect(harness.instance.isDone()).toBe(true);
    expect(region?.textContent).toBe('5 entries loaded');
    await wait(0);
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
    await wait(60);
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
