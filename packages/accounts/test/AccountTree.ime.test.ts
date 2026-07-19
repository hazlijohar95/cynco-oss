// IME composition guards: keydowns consumed by an active composition
// (`isComposing: true`, or the legacy `keyCode === 229` older engines emit)
// must never drive navigation, type-ahead, or rename commit/cancel — Enter
// confirms the IME candidate and Escape dismisses it, so hijacking either
// would truncate the in-flight composition.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { ACCOUNTS_TAG_NAME } from '../src/constants';
import { AccountTree } from '../src/render/AccountTree';
import {
  CHART_ACCOUNTS,
  type DomHandle,
  installDom,
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

function mountTree(): Mounted {
  const mounted = new AccountTree({ accounts: CHART_ACCOUNTS });
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

// Dispatches a keydown flagged as part of an IME composition, either via the
// standard `isComposing` flag or the legacy `keyCode === 229` (jsdom exposes
// both as prototype getters, overridden per instance for determinism).
function dispatchComposingKey(
  element: HTMLElement,
  key: string,
  mode: 'isComposing' | 'keyCode229'
): void {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  if (mode === 'isComposing') {
    Object.defineProperty(event, 'isComposing', { value: true });
  } else {
    Object.defineProperty(event, 'keyCode', { value: 229 });
  }
  element.dispatchEvent(event);
}

function queryRenameInput(rows: HTMLElement): HTMLInputElement | null {
  const input = rows.querySelector('[data-rename-input]');
  return input instanceof HTMLInputElement ? input : null;
}

describe('navigation and type-ahead ignore composition keys', () => {
  test('composing letters never type-ahead', () => {
    const { tree: mounted, scroller } = mountTree();
    dispatchComposingKey(scroller, 'l', 'isComposing');
    expect(mounted.getFocusedPath()).toBeNull();
    dispatchComposingKey(scroller, 'l', 'keyCode229');
    expect(mounted.getFocusedPath()).toBeNull();
  });

  test('composing arrows never move focus', () => {
    const { tree: mounted, scroller } = mountTree();
    mounted.getController().setFocusedPath('Assets');
    dispatchComposingKey(scroller, 'ArrowDown', 'isComposing');
    expect(mounted.getFocusedPath()).toBe('Assets');
    dispatchComposingKey(scroller, 'ArrowDown', 'keyCode229');
    expect(mounted.getFocusedPath()).toBe('Assets');
  });
});

describe('rename input during composition', () => {
  test('Enter during composition does not commit the rename', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.beginRename('Expenses:Rent');
    const input = queryRenameInput(rows);
    if (input == null) {
      throw new Error('rename input missing');
    }
    input.value = 'Sewa';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    dispatchComposingKey(input, 'Enter', 'isComposing');
    // The session stays open with the draft intact; nothing was renamed.
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
    expect(mounted.getController().getRenameDraft()).toBe('Sewa');
    expect(mounted.getController().hasAccount('Expenses:Rent')).toBe(true);
    expect(mounted.getController().hasAccount('Expenses:Sewa')).toBe(false);

    dispatchComposingKey(input, 'Enter', 'keyCode229');
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
    expect(mounted.getController().hasAccount('Expenses:Sewa')).toBe(false);
  });

  test('Escape during composition does not cancel the rename', () => {
    const { tree: mounted, rows } = mountTree();
    mounted.beginRename('Expenses:Rent');
    const input = queryRenameInput(rows);
    if (input == null) {
      throw new Error('rename input missing');
    }
    dispatchComposingKey(input, 'Escape', 'isComposing');
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
    dispatchComposingKey(input, 'Escape', 'keyCode229');
    expect(mounted.getController().getRenamingPath()).toBe('Expenses:Rent');
    // A real (non-composing) Escape still cancels.
    input.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(mounted.getController().getRenamingPath()).toBeNull();
  });
});
