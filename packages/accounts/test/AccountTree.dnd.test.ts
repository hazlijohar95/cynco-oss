// Wire-level drag & drop tests. jsdom implements neither DragEvent nor
// DataTransfer, so drags are synthesized as bubbling MouseEvents with a
// stubbed dataTransfer property — enough to exercise the view's delegation,
// guard calls, visuals, and drop application. Real browser DnD (ghost
// images, dropEffect cursors, cross-window drags) is e2e-wave territory.

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
import type { AccountMove } from '../src/types';
import {
  CHART_ACCOUNTS,
  type DomHandle,
  installDom,
  makeChartEntries,
  stubScrollerGeometry,
  wait,
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

interface FakeDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  data: Map<string, string>;
  setData(type: string, value: string): void;
}

function makeDataTransfer(): FakeDataTransfer {
  return {
    effectAllowed: '',
    dropEffect: '',
    data: new Map(),
    setData(type: string, value: string): void {
      this.data.set(type, value);
    },
  };
}

interface Mounted {
  tree: AccountTree;
  rows: HTMLElement;
}

function mountTree(options: AccountTreeOptions = {}): Mounted {
  const mounted = new AccountTree({
    accounts: CHART_ACCOUNTS,
    entries: makeChartEntries(),
    ...options,
  });
  mounted.render(document.body);
  tree = mounted;
  const shadowRoot = document.body.querySelector(ACCOUNTS_TAG_NAME)?.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rows = shadowRoot?.querySelector('[data-rows]');
  if (!(scroller instanceof HTMLElement) || !(rows instanceof HTMLElement)) {
    throw new Error('mountTree: shell missing');
  }
  stubScrollerGeometry(scroller, { height: 420, scrollHeight: 420 });
  return { tree: mounted, rows };
}

function rowByPath(
  mounted: AccountTree,
  rows: HTMLElement,
  path: string
): HTMLElement {
  const index = mounted.getController().getPathIndex(path);
  const row = rows.querySelector(`[data-row-index="${index}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row for ${path} not rendered`);
  }
  return row;
}

function dispatchDrag(
  element: HTMLElement,
  type: string,
  dataTransfer?: FakeDataTransfer
): MouseEvent {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  if (dataTransfer != null) {
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  }
  element.dispatchEvent(event);
  return event;
}

describe('drag & drop wiring', () => {
  test('a full drag → over → drop re-parents and fires onMove', () => {
    const batches: Array<readonly AccountMove[]> = [];
    const { tree: mounted, rows } = mountTree({
      onMove: (moves) => batches.push(moves),
    });
    const dataTransfer = makeDataTransfer();

    dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Current:Cash-Maybank'),
      'dragstart',
      dataTransfer
    );
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.data.get('text/plain')).toBe(
      'Assets:Current:Cash-Maybank'
    );
    expect(
      rowByPath(mounted, rows, 'Assets:Current:Cash-Maybank').getAttribute(
        'data-dragging'
      )
    ).toBe('true');

    const overEvent = dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Fixed'),
      'dragover',
      dataTransfer
    );
    // preventDefault on dragover is the HTML5 "drop allowed" signal.
    expect(overEvent.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('move');
    expect(
      rowByPath(mounted, rows, 'Assets:Fixed').getAttribute('data-drop-target')
    ).toBe('true');

    dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Fixed'),
      'drop',
      dataTransfer
    );
    expect(batches).toEqual([
      [
        {
          from: 'Assets:Current:Cash-Maybank',
          to: 'Assets:Fixed:Cash-Maybank',
        },
      ],
    ]);
    expect(
      mounted.getController().hasAccount('Assets:Fixed:Cash-Maybank')
    ).toBe(true);
    // Session visuals cleared after the drop.
    expect(rows.querySelector('[data-dragging]')).toBeNull();
    expect(rows.querySelector('[data-drop-target]')).toBeNull();
  });

  test('invalid targets are never marked and never allow the drop', () => {
    const { tree: mounted, rows } = mountTree();
    dispatchDrag(rowByPath(mounted, rows, 'Assets:Current'), 'dragstart');

    // Leaf row: not a target.
    const leafOver = dispatchDrag(
      rowByPath(mounted, rows, 'Expenses:Rent'),
      'dragover'
    );
    expect(leafOver.defaultPrevented).toBe(false);
    // Own descendant: guarded in the plan.
    const descendantOver = dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Current'),
      'dragover'
    );
    expect(descendantOver.defaultPrevented).toBe(false);
    // Current parent: no-op move.
    const parentOver = dispatchDrag(
      rowByPath(mounted, rows, 'Assets'),
      'dragover'
    );
    expect(parentOver.defaultPrevented).toBe(false);
    expect(rows.querySelector('[data-drop-target]')).toBeNull();

    // Dropping on an invalid target applies nothing.
    dispatchDrag(rowByPath(mounted, rows, 'Assets'), 'drop');
    expect(mounted.getController().hasAccount('Assets:Current')).toBe(true);
  });

  test('dragging a selected row drags the whole selection as a batch', () => {
    const batches: Array<readonly AccountMove[]> = [];
    const { tree: mounted, rows } = mountTree({
      onMove: (moves) => batches.push(moves),
    });
    const controller = mounted.getController();
    controller.selectPath('Assets:Current:Cash-CIMB');
    controller.selectPath('Assets:Current:Cash-Maybank', { additive: true });

    dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Current:Cash-CIMB'),
      'dragstart'
    );
    dispatchDrag(rowByPath(mounted, rows, 'Assets:Fixed'), 'dragover');
    dispatchDrag(rowByPath(mounted, rows, 'Assets:Fixed'), 'drop');

    expect(batches).toEqual([
      [
        { from: 'Assets:Current:Cash-CIMB', to: 'Assets:Fixed:Cash-CIMB' },
        {
          from: 'Assets:Current:Cash-Maybank',
          to: 'Assets:Fixed:Cash-Maybank',
        },
      ],
    ]);
    // Selection followed the batch move.
    expect(controller.getSelectedPaths()).toEqual([
      'Assets:Fixed:Cash-CIMB',
      'Assets:Fixed:Cash-Maybank',
    ]);
  });

  test('dragend without a drop clears the session and visuals', () => {
    const { tree: mounted, rows } = mountTree();
    dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Current:Cash-CIMB'),
      'dragstart'
    );
    dispatchDrag(rowByPath(mounted, rows, 'Assets:Fixed'), 'dragover');
    expect(rows.querySelector('[data-drop-target]')).not.toBeNull();

    dispatchDrag(rowByPath(mounted, rows, 'Assets:Fixed'), 'dragend');
    expect(rows.querySelector('[data-dragging]')).toBeNull();
    expect(rows.querySelector('[data-drop-target]')).toBeNull();
    expect(mounted.getController().hasAccount('Assets:Current:Cash-CIMB')).toBe(
      true
    );
  });

  test('hovering a collapsed group spring-loads its expansion', async () => {
    const { tree: mounted, rows } = mountTree({ dragExpandDelayMs: 5 });
    const controller = mounted.getController();
    controller.setExpanded('Assets:Fixed', false);

    dispatchDrag(
      rowByPath(mounted, rows, 'Assets:Current:Cash-CIMB'),
      'dragstart'
    );
    dispatchDrag(rowByPath(mounted, rows, 'Assets:Fixed'), 'dragover');
    expect(controller.isExpanded('Assets:Fixed')).toBe(false);

    await wait(25);
    expect(controller.isExpanded('Assets:Fixed')).toBe(true);
    // The drag session (and its target highlight) survives the rebuild.
    expect(
      rowByPath(mounted, rows, 'Assets:Fixed').getAttribute('data-drop-target')
    ).toBe('true');
  });
});
