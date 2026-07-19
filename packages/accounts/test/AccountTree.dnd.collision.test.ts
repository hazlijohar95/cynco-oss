// View-level drop collision wiring: the `dropCollision` option and the
// onMove / onDropComplete / onDropError callbacks, driven through the same
// synthesized MouseEvent drags as the base dnd suite (jsdom has no
// DragEvent/DataTransfer). The base suite covers the untouched defaults;
// this one exercises the strategies and the callback contracts.

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
import type { LedgerEntry } from '../src/types';
import { type DomHandle, installDom, stubScrollerGeometry } from './domHarness';

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

// Collision-rich chart: dropping X's children onto A:Y collides on N
// (A:Y:N already exists, with a subtree) while Clean moves freely.
const COLLISION_ACCOUNTS = [
  'A:X:N',
  'A:X:Clean',
  'A:Y:N:Deep',
  'Equity:Opening',
];

function makeEntries(): LedgerEntry[] {
  const entry = (id: string, account: string, amount: number): LedgerEntry => ({
    id,
    date: '2026-07-01',
    flag: 'cleared',
    payee: null,
    narration: id,
    tags: [],
    links: [],
    postings: [
      { account, amount, currency: 'MYR' },
      { account: 'Equity:Opening', amount: -amount, currency: 'MYR' },
    ],
  });
  return [entry('e-xn', 'A:X:N', 10_000), entry('e-deep', 'A:Y:N:Deep', 5_000)];
}

interface Mounted {
  tree: AccountTree;
  rows: HTMLElement;
}

function mountTree(options: AccountTreeOptions = {}): Mounted {
  const mounted = new AccountTree({
    accounts: COLLISION_ACCOUNTS,
    entries: makeEntries(),
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

function dispatchDrag(element: HTMLElement, type: string): MouseEvent {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
}

// Records every callback in arrival order so ordering contracts are
// assertable ('move' entries come from onMove, etc.).
interface Recorded {
  events: Array<{ kind: string; payload: unknown }>;
  options: AccountTreeOptions;
}

function makeRecorder(base: AccountTreeOptions = {}): Recorded {
  const events: Recorded['events'] = [];
  return {
    events,
    options: {
      ...base,
      onMove: (moves) => events.push({ kind: 'move', payload: moves }),
      onDropComplete: (result) =>
        events.push({ kind: 'complete', payload: result }),
      onDropError: (error) => events.push({ kind: 'error', payload: error }),
    },
  };
}

describe('dropCollision: reject (default)', () => {
  test('any collision blocks the whole drop and fires onDropError only', () => {
    const recorder = makeRecorder();
    const { tree: mounted, rows } = mountTree(recorder.options);
    const controller = mounted.getController();
    controller.selectPath('A:X:N');
    controller.selectPath('A:X:Clean', { additive: true });

    dispatchDrag(rowByPath(mounted, rows, 'A:X:N'), 'dragstart');
    // The collision-blocked target still ALLOWS the drop (preventDefault)
    // so the error is reportable instead of silently refusing the cursor.
    const over = dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    // Nothing moved — the clean candidate was blocked with the batch.
    expect(controller.hasAccount('A:X:N')).toBe(true);
    expect(controller.hasAccount('A:X:Clean')).toBe(true);
    expect(controller.hasAccount('A:Y:Clean')).toBe(false);
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(true);

    expect(recorder.events.map((event) => event.kind)).toEqual(['error']);
    expect(recorder.events[0].payload).toEqual({
      reason: 'collision',
      attempted: [
        { from: 'A:X:Clean', to: 'A:Y:Clean' },
        { from: 'A:X:N', to: 'A:Y:N' },
      ],
    });
  });

  test('a clean default drop fires onMove then onDropComplete', () => {
    const recorder = makeRecorder();
    const { tree: mounted, rows } = mountTree(recorder.options);

    dispatchDrag(rowByPath(mounted, rows, 'A:X:Clean'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    expect(mounted.getController().hasAccount('A:Y:Clean')).toBe(true);
    expect(recorder.events.map((event) => event.kind)).toEqual([
      'move',
      'complete',
    ]);
    expect(recorder.events[0].payload).toEqual([
      { from: 'A:X:Clean', to: 'A:Y:Clean' },
    ]);
    expect(recorder.events[1].payload).toEqual({
      moves: [{ from: 'A:X:Clean', to: 'A:Y:Clean' }],
      skipped: [],
      replaced: [],
    });
  });
});

describe('dropCollision: skip', () => {
  test('a mixed multi-select drop applies the clean moves and reports the skipped', () => {
    const recorder = makeRecorder({ dropCollision: 'skip' });
    const { tree: mounted, rows } = mountTree(recorder.options);
    const controller = mounted.getController();
    controller.selectPath('A:X:N');
    controller.selectPath('A:X:Clean', { additive: true });

    dispatchDrag(rowByPath(mounted, rows, 'A:X:N'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    expect(controller.hasAccount('A:Y:Clean')).toBe(true);
    expect(controller.hasAccount('A:X:N')).toBe(true); // Skipped, stayed put.
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(true); // Untouched.

    expect(recorder.events.map((event) => event.kind)).toEqual([
      'move',
      'complete',
    ]);
    expect(recorder.events[1].payload).toEqual({
      moves: [{ from: 'A:X:Clean', to: 'A:Y:Clean' }],
      skipped: [{ from: 'A:X:N', to: 'A:Y:N' }],
      replaced: [],
    });
  });

  test('all candidates colliding is a silent no-op: no highlight, no event', () => {
    const recorder = makeRecorder({ dropCollision: 'skip' });
    const { tree: mounted, rows } = mountTree(recorder.options);

    dispatchDrag(rowByPath(mounted, rows, 'A:X:N'), 'dragstart');
    const over = dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    expect(over.defaultPrevented).toBe(false);
    expect(rows.querySelector('[data-drop-target]')).toBeNull();
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    expect(mounted.getController().hasAccount('A:X:N')).toBe(true);
    expect(recorder.events).toEqual([]);
  });
});

describe('dropCollision: replace', () => {
  test('the colliding drop removes the target subtree and reports it replaced', () => {
    const recorder = makeRecorder({ dropCollision: 'replace' });
    const { tree: mounted, rows } = mountTree(recorder.options);
    const controller = mounted.getController();
    controller.selectPath('A:Y:N:Deep');

    dispatchDrag(rowByPath(mounted, rows, 'A:X:N'), 'dragstart');
    const over = dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    // The old subtree is gone (its entries dropped with it); the moved
    // account owns the path now and carries only its own balance.
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(false);
    expect(controller.hasAccount('A:X:N')).toBe(false);
    expect(controller.getRow('A:Y:N')?.kind).toBe('leaf');
    expect(controller.getRow('A:Y:N')?.balance).toBe(10_000);
    // Selection on the removed path was dropped, not remapped.
    expect(controller.getSelectedPaths()).toEqual([]);
    // Expansion state stays sane: ancestors still expanded, rows visible.
    expect(controller.getPathIndex('A:Y:N')).toBeGreaterThan(-1);

    expect(recorder.events.map((event) => event.kind)).toEqual([
      'move',
      'complete',
    ]);
    expect(recorder.events[1].payload).toEqual({
      moves: [{ from: 'A:X:N', to: 'A:Y:N' }],
      skipped: [],
      replaced: ['A:Y:N'],
    });
  });

  test('a mixed multi-select drop replaces and moves in one batch', () => {
    const recorder = makeRecorder({ dropCollision: 'replace' });
    const { tree: mounted, rows } = mountTree(recorder.options);
    const controller = mounted.getController();
    controller.selectPath('A:X:N');
    controller.selectPath('A:X:Clean', { additive: true });

    dispatchDrag(rowByPath(mounted, rows, 'A:X:N'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'dragover');
    dispatchDrag(rowByPath(mounted, rows, 'A:Y'), 'drop');

    expect(controller.hasAccount('A:Y:Clean')).toBe(true);
    expect(controller.hasAccount('A:Y:N')).toBe(true);
    expect(controller.hasAccount('A:Y:N:Deep')).toBe(false);
    // The surviving selection followed the batch move.
    expect(controller.getSelectedPaths()).toEqual(['A:Y:Clean', 'A:Y:N']);

    expect(recorder.events.map((event) => event.kind)).toEqual([
      'move',
      'complete',
    ]);
    // Drag order is the selection's visible render order: Clean before N.
    expect(recorder.events[1].payload).toEqual({
      moves: [
        { from: 'A:X:Clean', to: 'A:Y:Clean' },
        { from: 'A:X:N', to: 'A:Y:N' },
      ],
      skipped: [],
      replaced: ['A:Y:N'],
    });
  });
});

describe('drop error reasons beyond collisions', () => {
  test('dropping onto a leaf row reports invalid-target', () => {
    const recorder = makeRecorder();
    const { tree: mounted, rows } = mountTree(recorder.options);

    dispatchDrag(rowByPath(mounted, rows, 'A:X:Clean'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'Equity:Opening'), 'drop');

    expect(recorder.events).toEqual([
      { kind: 'error', payload: { reason: 'invalid-target', attempted: [] } },
    ]);
    expect(mounted.getController().hasAccount('A:X:Clean')).toBe(true);
  });

  test('dropping a group into its own subtree reports self-drop', () => {
    const recorder = makeRecorder();
    const { tree: mounted, rows } = mountTree(recorder.options);

    dispatchDrag(rowByPath(mounted, rows, 'A'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'A:X'), 'drop');

    expect(recorder.events).toEqual([
      {
        kind: 'error',
        payload: {
          reason: 'self-drop',
          attempted: [{ from: 'A', to: 'A:X:A' }],
        },
      },
    ]);
    expect(mounted.getController().hasAccount('A:X:N')).toBe(true);
  });

  test('dropping onto the current parent stays a silent no-op', () => {
    const recorder = makeRecorder();
    const { tree: mounted, rows } = mountTree(recorder.options);

    dispatchDrag(rowByPath(mounted, rows, 'A:X:Clean'), 'dragstart');
    dispatchDrag(rowByPath(mounted, rows, 'A:X'), 'drop');

    expect(recorder.events).toEqual([]);
    expect(mounted.getController().hasAccount('A:X:Clean')).toBe(true);
  });
});
