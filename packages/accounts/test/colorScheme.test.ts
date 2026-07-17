import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import { AccountTree } from '../src/render/AccountTree';
import { preloadAccountTreeHTML } from '../src/ssr/preloadAccountTree';
import {
  CHART_ACCOUNTS,
  type DomHandle,
  installDom,
  makeChartEntries,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

describe('AccountTree colorScheme', () => {
  test('dark pins an inline color-scheme on the host; system leaves it unset', () => {
    const dark = new AccountTree({
      accounts: CHART_ACCOUNTS,
      colorScheme: 'dark',
    });
    dark.render(document.body);
    const darkHost = document.querySelector(ACCOUNTS_TAG_NAME);
    expect((darkHost as HTMLElement).style.colorScheme).toBe('dark');
    dark.cleanUp();

    const system = new AccountTree({ accounts: CHART_ACCOUNTS });
    system.render(document.body);
    const systemHost = document.querySelector(ACCOUNTS_TAG_NAME);
    expect((systemHost as HTMLElement).style.colorScheme).toBe('');
    system.cleanUp();
  });

  test('setOptions switches the pin and system removes it again', () => {
    const instance = new AccountTree({
      accounts: CHART_ACCOUNTS,
      colorScheme: 'light',
    });
    instance.render(document.body);
    const host = document.querySelector(ACCOUNTS_TAG_NAME) as HTMLElement;
    expect(host.style.colorScheme).toBe('light');

    instance.setOptions({ colorScheme: 'dark' });
    expect(host.style.colorScheme).toBe('dark');

    instance.setOptions({ colorScheme: 'system' });
    expect(host.style.colorScheme).toBe('');
    instance.cleanUp();
  });

  test('hydrate applies the pin to an SSR-adopted container', async () => {
    const ssrHTML = await preloadAccountTreeHTML({
      accounts: CHART_ACCOUNTS,
      entries: makeChartEntries(),
    });
    const container = document.createElement(ACCOUNTS_TAG_NAME);
    container.attachShadow({ mode: 'open' }).innerHTML = ssrHTML;
    document.body.appendChild(container);

    const instance = new AccountTree(
      { accounts: CHART_ACCOUNTS, colorScheme: 'dark' },
      true
    );
    instance.hydrate(container);
    expect(container.style.colorScheme).toBe('dark');
    instance.cleanUp();
    container.remove();
  });
});
