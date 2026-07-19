// Context menu composition surface: the component emits requests (with
// normalized targets, positioning data, and a close() lifecycle) and the
// host renders the menu. These tests exercise every trigger path, the
// focus-restore / rename-handoff contract, and session supersession.

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
import type { AccountTreeContextMenuRequest } from '../src/types';
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
  shadowRoot: ShadowRoot;
  scroller: HTMLElement;
  rows: HTMLElement;
  requests: AccountTreeContextMenuRequest[];
}

function mountTree(options: Partial<AccountTreeOptions> = {}): Mounted {
  const requests: AccountTreeContextMenuRequest[] = [];
  const mounted = new AccountTree({
    accounts: CHART_ACCOUNTS,
    contextMenu: { onOpen: (request) => requests.push(request) },
    ...options,
  });
  mounted.render(document.body);
  tree = mounted;
  const shadowRoot = document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rows = shadowRoot?.querySelector('[data-rows]');
  if (
    shadowRoot == null ||
    !(scroller instanceof HTMLElement) ||
    !(rows instanceof HTMLElement)
  ) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, { height: 420, scrollHeight: 420 });
  return { tree: mounted, shadowRoot, scroller, rows, requests };
}

function rowByPath(mounted: Mounted, path: string): HTMLElement {
  const index = mounted.tree.getController().getPathIndex(path);
  const row = mounted.rows.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row for ${path} not rendered`);
  }
  return row;
}

function rightClick(
  row: HTMLElement,
  coords: { clientX: number; clientY: number } = { clientX: 40, clientY: 90 }
): MouseEvent {
  const event = new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    ...coords,
  });
  row.dispatchEvent(event);
  return event;
}

describe('right-click triggering', () => {
  test('emits a pointer request, selects the row, and prevents the native menu', () => {
    const mounted = mountTree();
    const event = rightClick(rowByPath(mounted, 'Expenses:Rent'), {
      clientX: 123,
      clientY: 45,
    });
    expect(event.defaultPrevented).toBe(true);
    expect(mounted.requests).toHaveLength(1);
    const request = mounted.requests[0];
    expect(request.path).toBe('Expenses:Rent');
    expect(request.paths).toEqual(['Expenses:Rent']);
    expect(request.source).toBe('pointer');
    expect(request.anchor).toEqual({ x: 123, y: 45 });
    // Standard tree UX: the target became the selection and focus.
    expect(mounted.tree.getSelectedPaths()).toEqual(['Expenses:Rent']);
    expect(mounted.tree.getFocusedPath()).toBe('Expenses:Rent');
  });

  test('a row inside the multi-selection targets the whole selection', () => {
    const mounted = mountTree();
    const controller = mounted.tree.getController();
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.selectPath('Assets:Current:Cash-Maybank', { additive: true });
    controller.selectPath('Expenses:Rent', { additive: true });

    rightClick(rowByPath(mounted, 'Assets:Current:Cash-Maybank'));
    const request = mounted.requests[0];
    expect(request.path).toBe('Assets:Current:Cash-Maybank');
    // Whole selection, visible render order (DnD normalization mirrored).
    expect(request.paths).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Expenses:Rent',
    ]);
    // The multi-selection survives; only focus moved to the target.
    expect(mounted.tree.getSelectedPaths()).toEqual([
      'Assets:Current:Cash-CIMB',
      'Assets:Current:Cash-Maybank',
      'Expenses:Rent',
    ]);
    expect(mounted.tree.getFocusedPath()).toBe('Assets:Current:Cash-Maybank');
  });

  test('a row outside the multi-selection replaces it', () => {
    const mounted = mountTree();
    const controller = mounted.tree.getController();
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.selectPath('Expenses:Rent', { additive: true });

    rightClick(rowByPath(mounted, 'Income'));
    expect(mounted.requests[0].paths).toEqual(['Income']);
    expect(mounted.tree.getSelectedPaths()).toEqual(['Income']);
  });

  test('sticky mirror rows and misses emit nothing', () => {
    const mounted = mountTree();
    mounted.scroller.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    expect(mounted.requests).toHaveLength(0);
  });

  test('right-click without contextMenu configured is left to the browser', () => {
    const requests: AccountTreeContextMenuRequest[] = [];
    const mounted = mountTree({ contextMenu: undefined });
    const event = rightClick(rowByPath(mounted, 'Expenses:Rent'));
    expect(event.defaultPrevented).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe('keyboard triggering', () => {
  test('Shift+F10 opens for the focused row with a rect anchor', () => {
    const mounted = mountTree();
    mounted.tree.getController().setFocusedPath('Expenses:Rent');
    dispatchKey(mounted.scroller, 'F10', { shiftKey: true });
    expect(mounted.requests).toHaveLength(1);
    const request = mounted.requests[0];
    expect(request.source).toBe('keyboard');
    expect(request.path).toBe('Expenses:Rent');
    expect('rect' in request.anchor).toBe(true);
  });

  test('the dedicated ContextMenu key opens too', () => {
    const mounted = mountTree();
    mounted.tree.getController().setFocusedPath('Income:Sales');
    dispatchKey(mounted.scroller, 'ContextMenu');
    expect(mounted.requests).toHaveLength(1);
    expect(mounted.requests[0].source).toBe('keyboard');
    expect(mounted.requests[0].path).toBe('Income:Sales');
  });

  test('no focused row means no request', () => {
    const mounted = mountTree();
    dispatchKey(mounted.scroller, 'F10', { shiftKey: true });
    dispatchKey(mounted.scroller, 'ContextMenu');
    expect(mounted.requests).toHaveLength(0);
  });

  test('plain F10 stays with the browser', () => {
    const mounted = mountTree();
    mounted.tree.getController().setFocusedPath('Expenses:Rent');
    dispatchKey(mounted.scroller, 'F10');
    expect(mounted.requests).toHaveLength(0);
  });
});

describe('row button lane', () => {
  test('renders a labelled menu button per row only when enabled', () => {
    const mounted = mountTree({
      contextMenu: { onOpen: () => {}, rowButton: true },
    });
    const button = rowByPath(mounted, 'Expenses:Rent').querySelector(
      '[data-row-action]'
    );
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Row actions');
    expect(button?.getAttribute('aria-haspopup')).toBe('menu');
    expect(button?.getAttribute('aria-hidden')).toBeNull();
    expect(button?.getAttribute('tabindex')).toBe('-1');
  });

  test('no button lane without rowButton', () => {
    const mounted = mountTree();
    expect(mounted.rows.querySelector('[data-row-action]')).toBeNull();
  });

  test('clicking the button opens with source button and a rect anchor', () => {
    const requests: AccountTreeContextMenuRequest[] = [];
    const mounted = mountTree({
      contextMenu: {
        onOpen: (request) => requests.push(request),
        rowButton: true,
      },
    });
    const button = rowByPath(mounted, 'Expenses:Rent').querySelector(
      '[data-row-action]'
    );
    button?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].source).toBe('button');
    expect(requests[0].path).toBe('Expenses:Rent');
    expect('rect' in requests[0].anchor).toBe(true);
    // The button click selected the row (it was not in the selection).
    expect(mounted.tree.getSelectedPaths()).toEqual(['Expenses:Rent']);
  });
});

describe('aria', () => {
  test('rows carry aria-haspopup only when contextMenu is configured', () => {
    const withMenu = mountTree();
    expect(
      rowByPath(withMenu, 'Expenses:Rent').getAttribute('aria-haspopup')
    ).toBe('menu');
    withMenu.tree.cleanUp();
    tree = undefined;

    const withoutMenu = mountTree({ contextMenu: undefined });
    expect(
      rowByPath(withoutMenu, 'Expenses:Rent').getAttribute('aria-haspopup')
    ).toBeNull();
  });
});

describe('close() focus lifecycle', () => {
  test('close() restores DOM focus and activedescendant to the originating row', () => {
    const mounted = mountTree();
    rightClick(rowByPath(mounted, 'Expenses:Rent'));
    const request = mounted.requests[0];
    request.close();
    const index = mounted.tree.getController().getPathIndex('Expenses:Rent');
    expect(mounted.tree.getFocusedPath()).toBe('Expenses:Rent');
    const active = mounted.shadowRoot.activeElement;
    expect(active).not.toBeNull();
    expect(active?.getAttribute('data-row-index')).toBe(String(index));
    expect(
      mounted.scroller
        .getAttribute('aria-activedescendant')
        ?.endsWith(`-row-${index}`)
    ).toBe(true);
  });

  test('close() re-materializes a row evicted by virtualization', () => {
    const requests: AccountTreeContextMenuRequest[] = [];
    const accounts = makeWideChart(20, 50); // 1020 rows at 30px.
    const mounted = new AccountTree({
      accounts,
      contextMenu: { onOpen: (request) => requests.push(request) },
    });
    mounted.render(document.body);
    tree = mounted;
    const shadowRoot =
      document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
    const scroller = shadowRoot?.querySelector('[data-scroller]');
    const rows = shadowRoot?.querySelector('[data-rows]');
    if (
      shadowRoot == null ||
      !(scroller instanceof HTMLElement) ||
      !(rows instanceof HTMLElement)
    ) {
      throw new Error('shell missing');
    }
    stubScrollerGeometry(scroller, { height: 300, scrollHeight: 1020 * 30 });
    dispatchScroll(scroller);

    const index = mounted.getController().getPathIndex('T00:L05');
    const row = rows.querySelector(`[data-row-index="${index}"]`);
    row?.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    expect(requests).toHaveLength(1);

    // Scroll the row far out of the window: its element is destroyed.
    scroller.scrollTop = 20_000;
    dispatchScroll(scroller);
    expect(rows.querySelector(`[data-row-index="${index}"]`)).toBeNull();

    // close() scrolls back, re-renders the row, and focuses it.
    requests[0].close();
    const revived = rows.querySelector(`[data-row-index="${index}"]`);
    expect(revived).not.toBeNull();
    expect(shadowRoot.activeElement).toBe(revived);
    expect(mounted.getFocusedPath()).toBe('T00:L05');
  });

  test('close({ restoreFocus: false }) + beginRename leaves the rename input focused', () => {
    const mounted = mountTree();
    rightClick(rowByPath(mounted, 'Expenses:Rent'));
    const request = mounted.requests[0];
    // The rename-handoff contract: the host ends the session without focus
    // restore, then starts the rename; the input must keep focus.
    request.close({ restoreFocus: false });
    mounted.tree.beginRename(request.path);
    const input = mounted.rows.querySelector('[data-rename-input]');
    expect(input).not.toBeNull();
    expect(mounted.shadowRoot.activeElement).toBe(input);
    expect(mounted.tree.getController().getRenamingPath()).toBe(
      'Expenses:Rent'
    );
  });

  test('a superseded session close is a no-op', () => {
    const mounted = mountTree();
    rightClick(rowByPath(mounted, 'Expenses:Rent'));
    rightClick(rowByPath(mounted, 'Income:Sales'));
    expect(mounted.requests).toHaveLength(2);
    const [first, second] = mounted.requests;

    // Closing the stale session must not steal focus back to its row.
    first.close();
    expect(mounted.tree.getFocusedPath()).toBe('Income:Sales');
    expect(mounted.shadowRoot.activeElement).not.toBe(
      rowByPath(mounted, 'Expenses:Rent')
    );

    // The live session still closes normally afterwards.
    second.close();
    expect(mounted.tree.getFocusedPath()).toBe('Income:Sales');
    const index = mounted.tree.getController().getPathIndex('Income:Sales');
    expect(
      mounted.shadowRoot.activeElement?.getAttribute('data-row-index')
    ).toBe(String(index));
  });

  test('double-closing one session restores focus only once and stays safe', () => {
    const mounted = mountTree();
    rightClick(rowByPath(mounted, 'Expenses:Rent'));
    const request = mounted.requests[0];
    request.close();
    // Second close: the session is already gone — nothing throws, nothing
    // moves.
    request.close();
    expect(mounted.tree.getFocusedPath()).toBe('Expenses:Rent');
  });
});
