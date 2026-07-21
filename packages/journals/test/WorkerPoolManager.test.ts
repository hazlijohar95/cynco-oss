import { describe, expect, test } from 'bun:test';

import { AMOUNT_FORMAT_DOT_COMMA } from '../src/constants';
import { renderRegisterRowsHTML } from '../src/renderers/RegisterRenderer';
import { proposeMatches } from '../src/utils/proposeMatches';
import {
  WorkerPoolManager,
  WorkerPoolTerminatedError,
} from '../src/worker/WorkerPoolManager';
import {
  makeBookPosting,
  makeRows,
  makeStatementLine,
  wait,
} from './domHarness';
import { createMockWorkerFactory } from './mockWorker';

describe('WorkerPoolManager', () => {
  test('renderRegisterWindow resolves the sync renderer output through workers', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 2,
    });
    const rows = makeRows(30);
    const range = { start: 5, end: 15 };
    const html = await pool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: null,
    });
    expect(html).toBe(renderRegisterRowsHTML(rows, range, null));
    expect(mock.instances.length).toBe(2);
    expect(pool.getStats().workersFailed).toBe(false);
    pool.terminate();
  });

  test('amountFormat reaches the worker AND the fallback with identical bytes', async () => {
    const rows = makeRows(12);
    const range = { start: 0, end: 12 };
    const expected = renderRegisterRowsHTML(
      rows,
      range,
      null,
      undefined,
      0,
      AMOUNT_FORMAT_DOT_COMMA
    );

    // Worker path.
    const workerMock = createMockWorkerFactory();
    const workerPool = new WorkerPoolManager({
      workerFactory: workerMock.factory,
      poolSize: 1,
    });
    const workerHTML = await workerPool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: null,
      amountFormat: AMOUNT_FORMAT_DOT_COMMA,
    });
    workerPool.terminate();

    // Failed-pool path: the fallback closure must produce the same bytes,
    // so the descriptor never being able to reach a worker is only a
    // performance regression, never a formatting one.
    const failedMock = createMockWorkerFactory('error-event');
    const failedPool = new WorkerPoolManager({
      workerFactory: failedMock.factory,
      poolSize: 1,
    });
    const fallbackHTML = await failedPool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: null,
      amountFormat: AMOUNT_FORMAT_DOT_COMMA,
    });
    expect(failedPool.getStats().workersFailed).toBe(true);
    failedPool.terminate();

    expect(workerHTML).toBe(expected);
    expect(fallbackHTML).toBe(expected);
    expect(workerHTML).toContain(',00');
  });

  test('proposeMatches resolves engine parity through workers', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const statementLines = [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
    ];
    const matches = await pool.proposeMatches({ statementLines, postings });
    expect(matches).toEqual(proposeMatches(statementLines, postings));
    pool.terminate();
  });

  test('identical in-flight requests dedupe onto one worker job', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const rows = makeRows(20);
    const range = { start: 0, end: 10 };
    const props = { rows, range, selectedIndex: null, cacheKey: 'w:1:0:10' };
    const [first, second, third] = await Promise.all([
      pool.renderRegisterWindow(props),
      pool.renderRegisterWindow(props),
      pool.renderRegisterWindow(props),
    ]);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mock.totalTaskPosts()).toBe(1);
    pool.terminate();
  });

  test('the LRU result cache satisfies repeat requests without worker traffic', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const rows = makeRows(20);
    const props = {
      rows,
      range: { start: 0, end: 10 },
      selectedIndex: null,
      cacheKey: 'w:1:0:10',
    };
    const first = await pool.renderRegisterWindow(props);
    expect(mock.totalTaskPosts()).toBe(1);
    const second = await pool.renderRegisterWindow(props);
    expect(second).toBe(first);
    expect(mock.totalTaskPosts()).toBe(1);
    expect(pool.getStats().cacheSize).toBe(1);
    pool.terminate();
  });

  test('LRU eviction: old keys recompute after the cache overflows', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
      resultCacheSize: 2,
    });
    const rows = makeRows(10);
    const request = (key: string, start: number) =>
      pool.renderRegisterWindow({
        rows,
        range: { start, end: start + 2 },
        selectedIndex: null,
        cacheKey: key,
      });
    await request('a', 0);
    await request('b', 1);
    await request('c', 2); // evicts 'a'
    expect(mock.totalTaskPosts()).toBe(3);
    await request('a', 0); // must recompute
    expect(mock.totalTaskPosts()).toBe(4);
    expect(pool.getStats().cacheSize).toBe(2);
    pool.terminate();
  });

  test('worker construction failure falls back to the main thread transparently', async () => {
    const pool = new WorkerPoolManager({
      workerFactory: () => {
        throw new Error('no Worker in this environment');
      },
      poolSize: 2,
    });
    const rows = makeRows(10);
    const range = { start: 0, end: 5 };
    const html = await pool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: 2,
    });
    expect(html).toBe(renderRegisterRowsHTML(rows, range, 2));
    expect(pool.isWorkingPool()).toBe(false);
    expect(pool.getStats().workersFailed).toBe(true);
    // Later requests keep working (and keep caching) in main-thread mode.
    const again = await pool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: 2,
      cacheKey: 'k',
    });
    expect(again).toBe(html);
    pool.terminate();
  });

  test('a worker error event fails the pool over to fallbacks mid-flight', async () => {
    const mock = createMockWorkerFactory('error-event');
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const rows = makeRows(6);
    const range = { start: 0, end: 6 };
    const html = await pool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: null,
    });
    expect(html).toBe(renderRegisterRowsHTML(rows, range, null));
    expect(pool.getStats().workersFailed).toBe(true);
    pool.terminate();
  });

  test('a single failed job falls back without failing the pool', async () => {
    const mock = createMockWorkerFactory('error-response');
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const rows = makeRows(4);
    const range = { start: 0, end: 4 };
    const html = await pool.renderRegisterWindow({
      rows,
      range,
      selectedIndex: null,
    });
    expect(html).toBe(renderRegisterRowsHTML(rows, range, null));
    expect(pool.getStats().workersFailed).toBe(false);
    pool.terminate();
  });

  test('terminate rejects in-flight tasks with WorkerPoolTerminatedError', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    await pool.initialize();
    const pending = pool.renderRegisterWindow({
      rows: makeRows(4),
      range: { start: 0, end: 4 },
      selectedIndex: null,
    });
    pool.terminate();
    expect(pending).rejects.toBeInstanceOf(WorkerPoolTerminatedError);
    await wait(5);
  });

  test('stats subscribers get an immediate snapshot and later updates', async () => {
    const mock = createMockWorkerFactory();
    const pool = new WorkerPoolManager({
      workerFactory: mock.factory,
      poolSize: 1,
    });
    const snapshots: string[] = [];
    const unsubscribe = pool.subscribeToStatChanges((stats) => {
      snapshots.push(stats.managerState);
    });
    expect(snapshots.length).toBe(1);
    await pool.initialize();
    await wait(5);
    expect(snapshots[snapshots.length - 1]).toBe('initialized');
    unsubscribe();
    pool.terminate();
  });
});
