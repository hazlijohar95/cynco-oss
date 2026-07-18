import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { EntryStream } from '../src/components/EntryStream';
import { JOURNALS_TAG_NAME } from '../src/constants';
import type { LedgerEntry } from '../src/types';
import { createEntryStreamFromArray } from '../src/utils/createEntryStreamFromArray';
import {
  dispatchScroll,
  type DomHandle,
  installDom,
  makeEntry,
  stubScrollerGeometry,
  wait,
} from './domHarness';

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
  scroller: HTMLElement;
  entriesElement: HTMLElement;
  countText(): string | null | undefined;
  cleanUp(): void;
}

function createHarness(instance: EntryStream): Harness {
  instance.render({ parentNode: document.body });
  const container = document.querySelector(JOURNALS_TAG_NAME);
  const shadowRoot =
    container instanceof HTMLElement ? container.shadowRoot : null;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const entriesElement = shadowRoot?.querySelector('[data-stream-entries]');
  if (
    !(scroller instanceof HTMLElement) ||
    !(entriesElement instanceof HTMLElement)
  ) {
    throw new Error('createHarness: stream skeleton missing');
  }
  return {
    instance,
    scroller,
    entriesElement,
    countText() {
      return shadowRoot?.querySelector('[data-stream-count]')?.textContent;
    },
    cleanUp() {
      instance.cleanUp();
    },
  };
}

describe('EntryStream', () => {
  test('entries arriving within one frame commit as a single DOM write', async () => {
    // All three entries are read as microtasks (delay 0), well before the
    // setTimeout-backed rAF flush fires — so exactly one append happens.
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(3)),
    });
    const harness = createHarness(instance);
    const insertSpy = spyOn(harness.entriesElement, 'insertAdjacentHTML');
    expect(harness.entriesElement.querySelectorAll('[data-entry]').length).toBe(
      0
    );
    await wait(20);
    expect(harness.entriesElement.querySelectorAll('[data-entry]').length).toBe(
      3
    );
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(harness.countText()).toBe('3');
    harness.cleanUp();
  });

  test('entries spread across frames append incrementally in order', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(3), { delayMs: 15 }),
    });
    const harness = createHarness(instance);
    await wait(25);
    const midCount =
      harness.entriesElement.querySelectorAll('[data-entry]').length;
    expect(midCount).toBeGreaterThanOrEqual(1);
    expect(midCount).toBeLessThan(3);
    await wait(60);
    const ids = Array.from(
      harness.entriesElement.querySelectorAll('[data-entry]')
    ).map((entry) => entry.getAttribute('data-entry-id'));
    expect(ids).toEqual(['stream-0', 'stream-1', 'stream-2']);
    harness.cleanUp();
  });

  test('footer tracks running count / total and flips to done', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(2)),
      total: 2,
    });
    const harness = createHarness(instance);
    const shadowRoot = harness.scroller.getRootNode() as ShadowRoot;
    expect(shadowRoot.querySelector('[data-stream-total]')?.textContent).toBe(
      '/ 2'
    );
    expect(shadowRoot.querySelector('[data-stream-state]')?.textContent).toBe(
      'streaming'
    );
    await wait(20);
    expect(harness.countText()).toBe('2');
    const state = shadowRoot.querySelector('[data-stream-state]');
    expect(state?.textContent).toBe('done');
    expect(state?.getAttribute('data-stream-done')).toBe('true');
    expect(harness.instance.isDone()).toBe(true);
    harness.cleanUp();
  });

  test('autoScroll sticks to the bottom until the user scrolls up, then re-engages', async () => {
    let controller!: ReadableStreamDefaultController<LedgerEntry>;
    const stream = new ReadableStream<LedgerEntry>({
      start(c) {
        controller = c;
      },
    });
    const instance = new EntryStream({ stream });
    const harness = createHarness(instance);
    stubScrollerGeometry(harness.scroller, {
      height: 200,
      scrollHeight: 1000,
    });

    controller.enqueue(makeEntries(1)[0]);
    await wait(20);
    // Initially engaged: the flush pins the scroller to the bottom.
    expect(harness.scroller.scrollTop).toBe(1000);

    // User scrolls up: the lock releases and appends stop moving the view.
    harness.scroller.scrollTop = 100;
    dispatchScroll(harness.scroller);
    controller.enqueue(makeEntries(2)[1]);
    await wait(20);
    expect(harness.scroller.scrollTop).toBe(100);

    // Scrolling back to (near) the bottom re-engages the lock.
    harness.scroller.scrollTop = 1000 - 200 - 10; // within the 20px slack
    dispatchScroll(harness.scroller);
    controller.enqueue(makeEntries(3)[2]);
    await wait(20);
    expect(harness.scroller.scrollTop).toBe(1000);

    controller.close();
    harness.cleanUp();
  });

  test('autoScroll: false never touches scrollTop', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(2)),
      autoScroll: false,
    });
    const harness = createHarness(instance);
    stubScrollerGeometry(harness.scroller, { height: 200, scrollHeight: 900 });
    harness.scroller.scrollTop = 0;
    await wait(20);
    expect(harness.scroller.scrollTop).toBe(0);
    harness.cleanUp();
  });

  test('onEntry and onDone fire with indices and the final count', async () => {
    const events: string[] = [];
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(3)),
      onEntry(entry, index) {
        events.push(`entry:${entry.id}:${index}`);
      },
      onDone(count) {
        events.push(`done:${count}`);
      },
    });
    const harness = createHarness(instance);
    await wait(20);
    expect(events).toEqual([
      'entry:stream-0:0',
      'entry:stream-1:1',
      'entry:stream-2:2',
      'done:3',
    ]);
    harness.cleanUp();
  });

  test('cleanUp cancels the reader: production stops and no DOM survives', async () => {
    const instance = new EntryStream({
      stream: createEntryStreamFromArray(makeEntries(10), { delayMs: 15 }),
    });
    const harness = createHarness(instance);
    await wait(25);
    const seen = harness.instance.getEntryCount();
    expect(seen).toBeGreaterThanOrEqual(1);
    harness.cleanUp();
    await wait(80);
    // Cancellation propagated: the count froze where cleanUp caught it.
    expect(harness.instance.getEntryCount()).toBe(seen);
    expect(document.querySelector(JOURNALS_TAG_NAME)).toBeNull();
  });
});
