import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import {
  type DomHandle,
  installDom,
  makeRows,
  stubScrollerGeometry,
  wait,
} from './domHarness';
import { createMockWorkerFactory } from './mockWorker';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const GEOMETRY = { height: 400, scrollHeight: 44 + 500 * 20 };

// Rows spread across months so grouped runs exercise real group boundaries.
function makeMonthSpreadRows(): ReturnType<typeof makeRows> {
  return makeRows(500).map((row, index) => ({
    ...row,
    entry: {
      ...row.entry,
      date: `2026-${String(Math.floor(index / 50) + 1).padStart(2, '0')}-10`,
    },
  }));
}

// Renders a register (worker-pooled or sync) over identical data/geometry
// and returns the settled rows innerHTML plus spacer heights. A fixed `id`
// makes the baked row ids (aria-activedescendant targets) comparable across
// instances — the same contract SSR/client agreement relies on; without it
// each instance auto-generates a unique prefix and bytes can never match.
async function renderRegister(
  options: Partial<RegisterOptions>
): Promise<{ rowsHTML: string; before: string; after: string }> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    id: 'worker-parity',
    virtualizer: new Virtualizer({ overscrollSize: 0 }),
    ...options,
  });
  register.render({
    rows: options.groupBy != null ? makeMonthSpreadRows() : makeRows(500),
    container,
    parentNode: document.body,
  });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  if (scroller instanceof HTMLElement) {
    stubScrollerGeometry(scroller, GEOMETRY);
  }
  // Two waits: the virtualizer's rAF window pass, then the worker round-trip
  // plus its rAF commit.
  await wait(10);
  await wait(10);
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  const before = shadowRoot?.querySelector('[data-register-spacer="before"]');
  const after = shadowRoot?.querySelector('[data-register-spacer="after"]');
  const result = {
    rowsHTML: (rowsElement as HTMLElement).innerHTML,
    before: (before as HTMLElement).style.height,
    after: (after as HTMLElement).style.height,
  };
  register.cleanUp();
  return result;
}

describe('Register worker pool integration', () => {
  test('worker-pooled windows render identical HTML to the sync path', async () => {
    const sync = await renderRegister({});
    // Renderer-visible ARIA additions must survive the worker round-trip:
    // roles and the id prefix are baked into the window HTML itself.
    expect(sync.rowsHTML).toContain('role="row"');
    expect(sync.rowsHTML).toContain('id="worker-parity-row-0"');

    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const pooled = await renderRegister({ workerPool: pool });
    expect(pooled.rowsHTML).toBe(sync.rowsHTML);
    expect(pooled.before).toBe(sync.before);
    expect(pooled.after).toBe(sync.after);
    expect(mock.totalTaskPosts()).toBeGreaterThanOrEqual(1);
    pool.terminate();
  });

  test('grouped windows render byte-identical HTML sync vs worker', async () => {
    const sync = await renderRegister({ groupBy: 'month' });
    expect(sync.rowsHTML).toContain('data-group-row');

    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const pooled = await renderRegister({ groupBy: 'month', workerPool: pool });
    expect(pooled.rowsHTML).toBe(sync.rowsHTML);
    expect(pooled.before).toBe(sync.before);
    expect(pooled.after).toBe(sync.after);
    expect(mock.totalTaskPosts()).toBeGreaterThanOrEqual(1);
    pool.terminate();
  });

  test('a failed pool degrades to main-thread output transparently', async () => {
    const sync = await renderRegister({});
    const pool = new WorkerPoolManager({
      workerFactory: () => {
        throw new Error('no workers here');
      },
    });
    // Let the pool discover the failure before the register renders.
    await pool.initialize();
    const pooled = await renderRegister({ workerPool: pool });
    expect(pooled.rowsHTML).toBe(sync.rowsHTML);
    expect(pool.isWorkingPool()).toBe(false);
    pool.terminate();
  });
});
