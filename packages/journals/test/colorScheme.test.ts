import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { JournalEntry } from '../src/components/JournalEntry';
import { LedgerView } from '../src/components/LedgerView';
import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { preloadJournalEntryHTML } from '../src/ssr/preloadJournalEntry';
import { type DomHandle, installDom, makeEntry, makeRows } from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const ACCOUNT = 'Assets:Current:Cash-Maybank';

describe('JournalEntry colorScheme', () => {
  test('dark pins an inline color-scheme on the host; system leaves it unset', () => {
    const dark = new JournalEntry({ colorScheme: 'dark' });
    dark.render({ entry: makeEntry(), parentNode: document.body });
    const darkHost = document.querySelector(JOURNALS_TAG_NAME);
    expect((darkHost as HTMLElement).style.colorScheme).toBe('dark');
    dark.cleanUp();

    const system = new JournalEntry();
    system.render({ entry: makeEntry(), parentNode: document.body });
    const systemHost = document.querySelector(JOURNALS_TAG_NAME);
    expect((systemHost as HTMLElement).style.colorScheme).toBe('');
    system.cleanUp();
  });

  test('setOptions switches the pin and system removes it again', () => {
    const instance = new JournalEntry({ colorScheme: 'light' });
    instance.render({ entry: makeEntry(), parentNode: document.body });
    const host = document.querySelector(JOURNALS_TAG_NAME) as HTMLElement;
    expect(host.style.colorScheme).toBe('light');

    instance.setOptions({ colorScheme: 'dark' });
    expect(host.style.colorScheme).toBe('dark');

    instance.setOptions({ colorScheme: 'system' });
    expect(host.style.colorScheme).toBe('');
    instance.cleanUp();
  });

  test('hydrate applies the pin to an SSR-adopted container', async () => {
    const entry = makeEntry();
    const ssrHTML = await preloadJournalEntryHTML(entry);
    const container = document.createElement(JOURNALS_TAG_NAME);
    container.attachShadow({ mode: 'open' }).innerHTML = ssrHTML;
    document.body.appendChild(container);

    const instance = new JournalEntry({ colorScheme: 'dark' }, true);
    instance.hydrate({ entry, container });
    expect(container.style.colorScheme).toBe('dark');
    instance.cleanUp();
    container.remove();
  });
});

describe('Register colorScheme', () => {
  test('render applies the pin; option updates track it', () => {
    const instance = new Register({
      account: ACCOUNT,
      colorScheme: 'dark',
      virtualizer: new Virtualizer({ overscrollSize: 0 }),
    });
    instance.render({ rows: makeRows(5), parentNode: document.body });
    const host = document.querySelector(JOURNALS_TAG_NAME) as HTMLElement;
    expect(host.style.colorScheme).toBe('dark');

    instance.setOptions({ account: ACCOUNT, colorScheme: 'light' });
    expect(host.style.colorScheme).toBe('light');

    instance.setOptions({ account: ACCOUNT });
    expect(host.style.colorScheme).toBe('');
    instance.cleanUp();
  });
});

describe('LedgerView colorScheme', () => {
  test('render applies the pin; option updates track it', () => {
    const instance = new LedgerView({ colorScheme: 'dark' });
    instance.render({
      sections: [{ account: ACCOUNT, rows: makeRows(5) }],
      parentNode: document.body,
    });
    const host = document.querySelector(JOURNALS_TAG_NAME) as HTMLElement;
    expect(host.style.colorScheme).toBe('dark');

    instance.setOptions({ colorScheme: 'system' });
    expect(host.style.colorScheme).toBe('');
    instance.cleanUp();
  });
});
