import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import {
  AccountTree,
  type AccountTreeOptions,
} from '../src/render/AccountTree';
import {
  CHART_ACCOUNTS,
  dispatchKey,
  dispatchScroll,
  type DomHandle,
  installDom,
  makeWideChart,
  stubScrollerGeometry,
} from './domHarness';

let dom: DomHandle;
let tree: AccountTree | undefined;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

afterEach(() => {
  tree?.cleanUp();
  tree = undefined;
});

interface Mounted {
  tree: AccountTree;
  scroller: HTMLElement;
  rows: HTMLElement;
}

function mountTree(options: AccountTreeOptions = {}): Mounted {
  const mounted = new AccountTree({ accounts: CHART_ACCOUNTS, ...options });
  mounted.render(document.body);
  tree = mounted;
  const shadowRoot = document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rows = shadowRoot?.querySelector('[data-rows]');
  if (!(scroller instanceof HTMLElement) || !(rows instanceof HTMLElement)) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, { height: 420, scrollHeight: 420 });
  return { tree: mounted, scroller, rows };
}

function queryRenameInput(rows: HTMLElement): HTMLInputElement | null {
  const input = rows.querySelector('[data-rename-input]');
  return input instanceof HTMLInputElement ? input : null;
}

function rowByIndex(rows: HTMLElement, index: number): HTMLElement {
  const row = rows.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row ${index} not rendered`);
  }
  return row;
}

function setDraft(rows: HTMLElement, value: string): HTMLInputElement {
  const input = queryRenameInput(rows);
  if (input == null) {
    throw new Error('rename input missing');
  }
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

describe('starting a rename', () => {
  test('F2 renames the focused row', () => {
    const { tree: mounted, scroller, rows } = mountTree();
    mounted.getController().setFocusedPath('Expenses:Rent');
    dispatchKey(scroller, 'F2');
    const input = queryRenameInput(rows);
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Rent');
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
  });

  test('double-click on an already-selected row starts a rename', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.getController().selectPath('Expenses:Rent');
    const index = mounted.getController().getPathIndex('Expenses:Rent');
    const row = rowByIndex(rows, index);
    // First click of the pair happens on the already-selected row.
    row.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, detail: 1 })
    );
    row.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, detail: 2 })
    );
    rowByIndex(rows, index).dispatchEvent(
      new window.MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
  });

  test('double-click on an unselected group still just toggles it', () => {
    const { tree: mounted, rows } = mountTree();
    const index = mounted.getController().getPathIndex('Assets');
    const row = rowByIndex(rows, index);
    row.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, detail: 1 })
    );
    row.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, detail: 2 })
    );
    rowByIndex(rows, index).dispatchEvent(
      new window.MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    expect(mounted.getController().getRenamingPath()).toBeNull();
    expect(mounted.getController().isExpanded('Assets')).toBe(false);
  });
});

describe('commit / cancel / blur semantics', () => {
  test('Enter commits the draft and fires the onRename option', () => {
    const renames: Array<[string, string]> = [];
    const { tree: mounted, rows } = mountTree({
      onRename: (oldPath, newPath) => renames.push([oldPath, newPath]),
    });
    mounted.beginRename('Expenses:Rent');
    const input = setDraft(rows, 'Office-Rent');
    input.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(mounted.getController().hasAccount('Expenses:Office-Rent')).toBe(
      true
    );
    expect(renames).toEqual([['Expenses:Rent', 'Expenses:Office-Rent']]);
    expect(queryRenameInput(rows)).toBeNull();
  });

  test('Escape cancels without touching the account', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.beginRename('Expenses:Rent');
    const input = setDraft(rows, 'Discarded');
    input.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(mounted.getController().getRenamingPath()).toBeNull();
    expect(mounted.getController().hasAccount('Expenses:Rent')).toBe(true);
    expect(queryRenameInput(rows)).toBeNull();
  });

  test('blur commits the rename', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.beginRename('Expenses:Rent');
    const input = setDraft(rows, 'Premises');
    input.dispatchEvent(new window.Event('focusout', { bubbles: true }));
    expect(mounted.getController().hasAccount('Expenses:Premises')).toBe(true);
    expect(mounted.getController().getRenamingPath()).toBeNull();
  });

  test('an invalid commit reverts instead of trapping focus', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.beginRename('Expenses:Rent');
    const input = setDraft(rows, '');
    input.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(mounted.getController().getRenamingPath()).toBeNull();
    expect(mounted.getController().hasAccount('Expenses:Rent')).toBe(true);
  });

  test('tree navigation keys are not hijacked while typing', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.getController().setFocusedPath('Expenses:Rent');
    mounted.beginRename('Expenses:Rent');
    const input = queryRenameInput(rows);
    input?.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    );
    // Focus did not move: the key belonged to the text editor.
    expect(mounted.getFocusedPath()).toBe('Expenses:Rent');
  });
});

describe('rename survives virtualization windows', () => {
  test('the input re-appears with the live draft after eviction and return', () => {
    const accounts = makeWideChart(20, 50); // 1020 rows at 30px.
    const mounted = new AccountTree({ accounts });
    mounted.render(document.body);
    tree = mounted;
    const shadowRoot =
      document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
    const scroller = shadowRoot?.querySelector('[data-scroller]');
    const rows = shadowRoot?.querySelector('[data-rows]');
    if (!(scroller instanceof HTMLElement) || !(rows instanceof HTMLElement)) {
      throw new Error('shell missing');
    }
    stubScrollerGeometry(scroller, { height: 300, scrollHeight: 1020 * 30 });
    dispatchScroll(scroller);

    // Rename the second row (T00:L00) and type a draft.
    mounted.beginRename('T00:L00');
    setDraft(rows, 'L00-renamed');

    // Scroll the row far out of the window: the input is destroyed with it,
    // but the session (and draft) live in the controller.
    scroller.scrollTop = 20_000;
    dispatchScroll(scroller);
    expect(queryRenameInput(rows)).toBeNull();
    expect(mounted.getController().getRenamingPath()).toBe('T00:L00');
    expect(mounted.getController().getRenameDraft()).toBe('L00-renamed');
    // Eviction must not have blur-committed the rename.
    expect(mounted.getController().hasAccount('T00:L00')).toBe(true);

    // Scroll back: the row re-renders with the input and the draft intact.
    scroller.scrollTop = 0;
    dispatchScroll(scroller);
    const revived = queryRenameInput(rows);
    expect(revived).not.toBeNull();
    expect(revived?.value).toBe('L00-renamed');

    // Committing after the round-trip applies the draft.
    revived?.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(mounted.getController().hasAccount('T00:L00-renamed')).toBe(true);
  });
});
