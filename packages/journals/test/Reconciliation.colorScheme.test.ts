import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Reconciliation } from '../src/components/Reconciliation';
import { JOURNALS_TAG_NAME } from '../src/constants';
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

function makeData(): {
  statementLines: ReturnType<typeof makeStatementLine>[];
  postings: ReturnType<typeof makeBookPosting>[];
} {
  return {
    statementLines: [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
    ],
    postings: [
      makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
    ],
  };
}

describe('Reconciliation colorScheme', () => {
  test('dark pins an inline color-scheme on the host; system leaves it unset', () => {
    const dark = new Reconciliation({
      account: ACCOUNT,
      colorScheme: 'dark',
      ...makeData(),
    });
    dark.render({ parentNode: document.body });
    const darkHost = document.querySelector(JOURNALS_TAG_NAME);
    expect((darkHost as HTMLElement).style.colorScheme).toBe('dark');
    dark.cleanUp();

    const system = new Reconciliation({ account: ACCOUNT, ...makeData() });
    system.render({ parentNode: document.body });
    const systemHost = document.querySelector(JOURNALS_TAG_NAME);
    expect((systemHost as HTMLElement).style.colorScheme).toBe('');
    system.cleanUp();
  });

  test('setOptions switches the pin and system removes it again', () => {
    const data = makeData();
    const instance = new Reconciliation({
      account: ACCOUNT,
      colorScheme: 'light',
      ...data,
    });
    instance.render({ parentNode: document.body });
    const host = document.querySelector(JOURNALS_TAG_NAME) as HTMLElement;
    expect(host.style.colorScheme).toBe('light');

    instance.setOptions({ account: ACCOUNT, colorScheme: 'dark', ...data });
    expect(host.style.colorScheme).toBe('dark');

    instance.setOptions({ account: ACCOUNT, colorScheme: 'system', ...data });
    expect(host.style.colorScheme).toBe('');
    instance.cleanUp();
  });
});
